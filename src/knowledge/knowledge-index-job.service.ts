import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from './knowledge.service';
import { classifyKnowledgeIndexJobError } from './knowledge-index-job-error';
import { abortAllAwsRequests } from '../common/aws/aws-request-control';
import { KnowledgeIndexLeaseLostError } from './knowledge-index-lease';

const ACTIVE_JOB_STATUSES = ['queued', 'processing'];
const LEASE_MILLISECONDS = 5 * 60 * 1000;

@Injectable()
export class KnowledgeIndexJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeIndexJobService.name);
  private timer?: NodeJS.Timeout;
  private drainPromise?: Promise<void>;
  private stopping = false;
  private maintenancePromise?: Promise<void>;
  private activeController?: AbortController;

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeService: KnowledgeService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    if (!this.workerEnabled()) return;
    await this.recoverExpired();
    this.timer = setInterval(() => this.scheduleDrain(), 500);
    this.timer.unref();
    this.scheduleDrain();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.activeController?.abort(
      Object.assign(new Error('Worker is shutting down.'), {
        name: 'AbortError',
      }),
    );
    abortAllAwsRequests();
    await this.maintenancePromise?.catch(() => undefined);
    await this.drainPromise?.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Knowledge index worker shutdown failed: ${message}`);
    });
  }

  async submit(
    fileId: string,
    appcode: string,
    operation: 'index' | 'reindex',
    idempotencyKey?: string,
  ) {
    if (this.stopping)
      throw new ServiceUnavailableException('인덱싱 워커가 종료 중입니다.');
    const normalizedKey = idempotencyKey?.trim() || null;
    if (normalizedKey && normalizedKey.length > 128) {
      throw new BadRequestException('Idempotency-Key는 128자 이하여야 합니다.');
    }
    const file = await this.prisma.knowledgeFile.findFirst({
      where: { id: fileId, appcode },
      select: { id: true, status: true },
    });
    if (!file)
      throw new NotFoundException(`Knowledge file ${fileId} not found`);
    if (file.status === 'archived') {
      throw new BadRequestException('보관 처리된 파일은 인덱싱할 수 없습니다.');
    }

    if (normalizedKey) {
      const existing = await this.prisma.knowledgeIndexJob.findUnique({
        where: {
          appcode_idempotencyKey: { appcode, idempotencyKey: normalizedKey },
        },
      });
      if (existing) {
        if (existing.fileId !== fileId || existing.operation !== operation) {
          throw new ConflictException(
            'Idempotency-Key가 다른 인덱싱 요청에 사용되었습니다.',
          );
        }
        return existing;
      }
    }

    const active = await this.prisma.knowledgeIndexJob.findFirst({
      where: { fileId, appcode, status: { in: ACTIVE_JOB_STATUSES } },
      orderBy: { requestedAt: 'asc' },
    });
    if (active) return active;

    const job = await this.prisma.knowledgeIndexJob.create({
      data: {
        fileId,
        appcode,
        operation,
        idempotencyKey: normalizedKey,
        maxAttempts: this.maxAttempts(),
      },
    });
    if (this.workerEnabled()) queueMicrotask(() => this.scheduleDrain());
    return job;
  }

  async get(jobId: string, appcode: string) {
    const job = await this.prisma.knowledgeIndexJob.findFirst({
      where: { id: jobId, appcode },
    });
    if (!job)
      throw new NotFoundException(`Knowledge index job ${jobId} not found`);
    return job;
  }

  async retry(jobId: string, appcode: string) {
    if (this.stopping)
      throw new ServiceUnavailableException('인덱싱 워커가 종료 중입니다.');
    const job = await this.get(jobId, appcode);
    if (job.status !== 'failed') {
      throw new BadRequestException(
        '실패한 인덱싱 작업만 재시도할 수 있습니다.',
      );
    }
    if (job.attempt >= job.maxAttempts) {
      throw new BadRequestException(
        '인덱싱 작업의 최대 재시도 횟수를 초과했습니다.',
      );
    }
    if (!job.retryable) {
      throw new BadRequestException(
        '영구 실패로 분류된 인덱싱 작업은 재시도할 수 없습니다.',
      );
    }
    const queued = await this.prisma.knowledgeIndexJob.update({
      where: { id: job.id },
      data: {
        status: 'queued',
        errorCode: null,
        errorMessage: null,
        retryable: false,
        nextAttemptAt: null,
        startedAt: null,
        completedAt: null,
        leaseExpiresAt: null,
      },
    });
    if (this.workerEnabled()) queueMicrotask(() => this.scheduleDrain());
    return queued;
  }

  async drain(appcode?: string) {
    if (this.stopping) return;
    if (this.drainPromise) return this.drainPromise;
    const drainPromise = this.drainAvailable(appcode);
    this.drainPromise = drainPromise;
    try {
      await drainPromise;
    } finally {
      if (this.drainPromise === drainPromise) this.drainPromise = undefined;
    }
  }

  private async drainAvailable(appcode?: string) {
    await this.recoverExpired(appcode);
    while (!this.stopping) {
      const job = await this.claimNext(appcode);
      if (!job) break;
      if (this.stopping) {
        // Shutdown may begin while the database claim is in flight.
        await this.prisma.knowledgeIndexJob.updateMany({
          where: { id: job.id, status: 'processing', attempt: job.attempt },
          data: {
            status: 'queued',
            attempt: { decrement: 1 },
            startedAt: null,
            leaseExpiresAt: null,
          },
        });
        break;
      }
      await this.process(job);
    }
  }

  private async claimNext(appcode?: string) {
    for (;;) {
      const candidate = await this.prisma.knowledgeIndexJob.findFirst({
        where: {
          status: 'queued',
          ...(appcode ? { appcode } : {}),
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        orderBy: { requestedAt: 'asc' },
      });
      if (!candidate || this.stopping) return null;
      if (candidate.attempt >= candidate.maxAttempts) {
        await this.prisma.knowledgeIndexJob.updateMany({
          where: {
            id: candidate.id,
            status: 'queued',
            attempt: candidate.attempt,
          },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorCode: 'INDEX_ATTEMPTS_EXHAUSTED',
            errorMessage: '인덱싱 최대 시도 횟수를 초과했습니다.',
            nextAttemptAt: null,
          },
        });
        continue;
      }
      const startedAt = new Date();
      const claimed = await this.prisma.knowledgeIndexJob.updateMany({
        where: {
          id: candidate.id,
          status: 'queued',
          attempt: candidate.attempt,
        },
        data: {
          status: 'processing',
          attempt: { increment: 1 },
          startedAt,
          leaseExpiresAt: new Date(
            startedAt.getTime() + this.leaseMilliseconds(),
          ),
          nextAttemptAt: null,
        },
      });
      if (claimed.count === 1) {
        return {
          ...candidate,
          status: 'processing',
          attempt: candidate.attempt + 1,
        };
      }
    }
  }

  private async process(job: {
    id: string;
    fileId: string;
    appcode: string;
    attempt: number;
    maxAttempts: number;
  }) {
    const controller = new AbortController();
    this.activeController = controller;
    let renewal: Promise<void> | undefined;
    const owned = () => ({
      id: job.id,
      attempt: job.attempt,
      status: 'processing',
      leaseExpiresAt: { gt: new Date() },
    });
    const heartbeat = setInterval(
      () => {
        if (renewal || controller.signal.aborted) return;
        renewal = this.prisma.knowledgeIndexJob
          .updateMany({
            where: owned(),
            data: {
              leaseExpiresAt: new Date(Date.now() + this.leaseMilliseconds()),
            },
          })
          .then((result) => {
            if (result.count !== 1)
              controller.abort(new KnowledgeIndexLeaseLostError());
          })
          .catch(() => controller.abort(new KnowledgeIndexLeaseLostError()))
          .finally(() => {
            renewal = undefined;
          });
      },
      Math.floor(this.leaseMilliseconds() / 3),
    );
    heartbeat.unref();
    try {
      const app = await this.prisma.appInfo.findUnique({
        where: { appcode: job.appcode },
        select: { appcode: true, defaultEmbeddingModelId: true },
      });
      if (!app) throw new Error(`AppInfo ${job.appcode} not found`);
      await this.knowledgeService.indexKnowledgeFile(
        job.fileId,
        app,
        controller.signal,
        { id: job.id, attempt: job.attempt },
      );
      await this.prisma.knowledgeIndexJob.updateMany({
        where: owned(),
        data: {
          status: 'completed',
          completedAt: new Date(),
          leaseExpiresAt: null,
          errorCode: null,
          errorMessage: null,
          retryable: false,
          nextAttemptAt: null,
        },
      });
    } catch (error) {
      if (
        error instanceof KnowledgeIndexLeaseLostError ||
        controller.signal.reason instanceof KnowledgeIndexLeaseLostError
      )
        return;
      const failure = classifyKnowledgeIndexJobError(
        error,
        job.attempt,
        this.retryDelayMs(),
      );
      const willRetry = failure.retryable && job.attempt < job.maxAttempts;
      await this.prisma.knowledgeIndexJob.updateMany({
        where: owned(),
        data: {
          status: willRetry ? 'queued' : 'failed',
          completedAt: willRetry ? null : new Date(),
          leaseExpiresAt: null,
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
          retryable: failure.retryable,
          nextAttemptAt: willRetry
            ? new Date(Date.now() + failure.retryAfterMs)
            : null,
        },
      });
    } finally {
      clearInterval(heartbeat);
      await renewal;
      if (this.activeController === controller)
        this.activeController = undefined;
    }
  }

  private async recoverExpired(appcode?: string) {
    if (this.stopping) return;
    await this.prisma.$executeRaw`
      UPDATE knowledge_index_job SET
        status = CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'queued' END,
        completed_at = CASE WHEN attempt >= max_attempts THEN (clock_timestamp() AT TIME ZONE 'UTC') ELSE NULL END,
        error_code = 'INDEX_LEASE_EXPIRED',
        error_message = '인덱싱 작업 임대가 만료되었습니다.',
        retryable = (attempt < max_attempts), lease_expires_at = NULL,
        started_at = NULL, next_attempt_at = NULL, updated_at = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE status = 'processing' AND lease_expires_at <= (clock_timestamp() AT TIME ZONE 'UTC')
        AND (${appcode ?? null}::text IS NULL OR appcode = ${appcode ?? null})
    `;
  }

  protected leaseMilliseconds() {
    return LEASE_MILLISECONDS;
  }

  private scheduleDrain() {
    if (this.stopping) return;
    if (!this.maintenancePromise) {
      this.maintenancePromise = this.recoverExpired()
        .catch(() => {
          this.logger.error('Knowledge index lease recovery failed.');
        })
        .finally(() => {
          this.maintenancePromise = undefined;
        });
    }
    void this.drain().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Knowledge index worker drain failed: ${message}`);
    });
  }

  private maxAttempts() {
    const value = Number(
      this.configService.get<string>('KNOWLEDGE_INDEX_MAX_ATTEMPTS') ?? 3,
    );
    return Number.isInteger(value) && value >= 1 && value <= 10 ? value : 3;
  }

  private retryDelayMs() {
    const value = Number(
      this.configService.get<string>('KNOWLEDGE_INDEX_RETRY_DELAY_MS') ?? 1_000,
    );
    return Number.isInteger(value) && value >= 100 && value <= 60_000
      ? value
      : 1_000;
  }

  private workerEnabled() {
    return (
      this.configService.get<string>('KNOWLEDGE_INDEX_WORKER_ENABLED') !==
      'false'
    );
  }
}
