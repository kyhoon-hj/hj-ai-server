import { createHash, randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { parseHjWorksSsoV1Identity } from '../contracts/hj-works-identity.contract';
import {
  CONSOLE_PERMISSIONS,
  type ConsoleIdentityContext,
} from './console-identity-context';

const SESSION_COOKIE = 'hj_console_session';
const STATE_COOKIE = 'hj_console_state';
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class ConsoleWorksAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly modules: ModuleRef,
  ) {}

  private get prisma() {
    return this.modules.get(PrismaService, { strict: false });
  }

  enabled() {
    return this.config.get<string>('CONSOLE_WORKS_SSO_ENABLED') === 'true';
  }

  private settings() {
    if (!this.enabled())
      throw new ServiceUnavailableException(
        'Works 로그인이 설정되지 않았습니다.',
      );
    const origin = this.config.getOrThrow<string>('CONSOLE_PUBLIC_ORIGIN');
    return {
      origin,
      callback: `${origin}/console/auth/callback`,
      worksOrigin: this.config.getOrThrow<string>('WORKS_PUBLIC_ORIGIN'),
      apiOrigin: this.config.getOrThrow<string>('WORKS_API_ORIGIN'),
      clientId: this.config.getOrThrow<string>('WORKS_CONSOLE_CLIENT_ID'),
      clientSecret: this.config.getOrThrow<string>(
        'WORKS_CONSOLE_CLIENT_SECRET',
      ),
    };
  }

  private cookie(request: Request, name: string) {
    const values = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`));
    if (values.length !== 1) return null;
    const value = values[0].slice(name.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }

  private setCookie(
    response: Response,
    name: string,
    value: string,
    maxAge: number,
  ) {
    response.cookie(name, value, {
      httpOnly: true,
      secure: this.settings().origin.startsWith('https:'),
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
  }

  assertOrigin(request: Request) {
    if (request.headers.origin !== this.settings().origin) {
      throw new ForbiddenException('Console 요청 출처가 올바르지 않습니다.');
    }
  }

  async login(response: Response) {
    const settings = this.settings();
    const state = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.consoleAuthState.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
      this.prisma.consoleSession.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
      this.prisma.consoleAuthState.create({
        data: {
          hash: hash(state),
          expiresAt: new Date(now.getTime() + 60_000),
        },
      }),
    ]);
    this.setCookie(response, STATE_COOKIE, state, 60_000);
    const authorize = new URL('/sso/authorize', settings.worksOrigin);
    authorize.searchParams.set('client_id', settings.clientId);
    authorize.searchParams.set('state', state);
    response.redirect(302, authorize.toString());
  }

  async callback(request: Request, response: Response) {
    const settings = this.settings();
    const state = this.cookie(request, STATE_COOKIE);
    this.setCookie(response, STATE_COOKIE, '', 0);
    if (
      !state ||
      request.query.state !== state ||
      typeof request.query.code !== 'string' ||
      request.query.code.length < 1 ||
      request.query.code.length > 2000
    ) {
      throw new UnauthorizedException(
        '로그인 요청이 만료되었거나 올바르지 않습니다.',
      );
    }
    const consumed = await this.prisma.consoleAuthState.deleteMany({
      where: { hash: hash(state), expiresAt: { gt: new Date() } },
    });
    if (consumed.count !== 1)
      throw new UnauthorizedException(
        '이미 사용되었거나 만료된 로그인 요청입니다.',
      );
    let payload: unknown;
    try {
      const upstream = await fetch(
        new URL('/api/v1/auth/service-code/exchange', settings.apiOrigin),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: request.query.code,
            clientId: settings.clientId,
            clientSecret: settings.clientSecret,
            redirectUri: settings.callback,
          }),
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        },
      );
      if (!upstream.ok) throw new Error('Works exchange rejected');
      payload = await upstream.json();
    } catch {
      throw new UnauthorizedException(
        'Works 로그인 확인에 실패했습니다. 다시 로그인해 주세요.',
      );
    }
    let binding: ReturnType<typeof parseHjWorksSsoV1Identity>;
    try {
      binding = parseHjWorksSsoV1Identity(payload);
    } catch {
      throw new UnauthorizedException('Works 인증 응답이 올바르지 않습니다.');
    }
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(
      Math.min(binding.expiresAt.getTime(), now.getTime() + 300_000),
    );
    await this.prisma.$transaction(async (tx) => {
      // Organization and permission provisioning is explicit; login never grants new rights.
      const organization = await tx.consoleOrganization.findUnique({
        where: { worksOrganizationId: binding.worksOrganizationId },
      });
      if (!organization || organization.status !== 'ACTIVE')
        throw new ForbiddenException(
          'Console 사용이 허용되지 않은 조직입니다.',
        );
      const identity = await tx.consoleIdentity.upsert({
        where: { worksUserId: binding.worksUserId },
        create: {
          worksUserId: binding.worksUserId,
          email: binding.email,
          displayName: binding.displayName,
          lastSyncedAt: now,
        },
        update: {
          email: binding.email,
          displayName: binding.displayName,
          lastSyncedAt: now,
        },
      });
      const membership = await tx.consoleMembership.findUnique({
        where: {
          organizationId_identityId: {
            organizationId: organization.id,
            identityId: identity.id,
          },
        },
      });
      if (
        identity.status !== 'ACTIVE' ||
        !membership ||
        membership.status !== 'ACTIVE' ||
        membership.worksRole !== binding.membershipRole
      )
        throw new ForbiddenException(
          'Console 멤버십 또는 역할 승인이 필요합니다.',
        );
      const oldToken = this.cookie(request, SESSION_COOKIE);
      if (oldToken)
        await tx.consoleSession.deleteMany({ where: { hash: hash(oldToken) } });
      await tx.consoleSession.create({
        data: {
          hash: hash(token),
          membershipId: membership.id,
          worksRole: binding.membershipRole,
          expiresAt,
        },
      });
    });
    this.setCookie(
      response,
      SESSION_COOKIE,
      token,
      expiresAt.getTime() - Date.now(),
    );
    response.redirect(302, '/console');
  }

  async resolve(request: Request): Promise<ConsoleIdentityContext | null> {
    if (!this.enabled()) return null;
    const token = this.cookie(request, SESSION_COOKIE);
    if (!token) return null;
    const session = await this.prisma.consoleSession.findUnique({
      where: { hash: hash(token) },
    });
    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      await this.prisma.consoleSession.deleteMany({
        where: { hash: hash(token) },
      });
      return null;
    }
    const membership = await this.prisma.consoleMembership.findUnique({
      where: { id: session.membershipId },
      include: { identity: true, organization: true },
    });
    if (
      !membership ||
      membership.worksRole !== session.worksRole ||
      membership.status !== 'ACTIVE' ||
      membership.identity.status !== 'ACTIVE' ||
      membership.organization.status !== 'ACTIVE'
    ) {
      await this.prisma.consoleSession.deleteMany({
        where: { hash: hash(token) },
      });
      return null;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
      this.assertOrigin(request);
    return {
      authenticationSource: 'works-session',
      identityId: membership.identityId,
      worksUserId: membership.identity.worksUserId,
      identityStatus: membership.identity.status,
      organizationId: membership.organizationId,
      worksOrganizationId: membership.organization.worksOrganizationId,
      organizationStatus: membership.organization.status,
      membershipId: membership.id,
      membershipStatus: membership.status,
      displayName: membership.identity.displayName ?? '',
      organizationName: membership.organization.displayName,
      permissions: CONSOLE_PERMISSIONS.filter((permission) =>
        membership.permissions.includes(permission),
      ),
    };
  }

  async logout(request: Request, response: Response) {
    this.assertOrigin(request);
    const token = this.cookie(request, SESSION_COOKIE);
    if (token)
      await this.prisma.consoleSession.deleteMany({
        where: { hash: hash(token) },
      });
    this.setCookie(response, SESSION_COOKIE, '', 0);
    response.status(204).end();
  }
}
