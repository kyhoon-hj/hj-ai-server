import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { classifyKnowledgeIndexJobError } from '../knowledge/knowledge-index-job-error';
import { PrismaService } from '../prisma/prisma.service';
import { FamilyKnowledgeIndexLeaseLostError } from './family-knowledge-index-lease';
import { FamilyKnowledgeIndexService } from './family-knowledge-index.service';

const LEASE_MILLISECONDS = 5 * 60 * 1000;

@Injectable()
export class FamilyKnowledgeIndexJobService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FamilyKnowledgeIndexJobService.name);
  private timer?: NodeJS.Timeout;
  private drainPromise?: Promise<void>;
  private maintenancePromise?: Promise<void>;
  private activeController?: AbortController;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: FamilyKnowledgeIndexService,
    private readonly config: ConfigService,
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
      Object.assign(new Error('Family index worker is shutting down.'), {
        name: 'AbortError',
      }),
    );
    await this.maintenancePromise?.catch(() => undefined);
    await this.drainPromise?.catch(() => undefined);
  }

  async drain(appcode?: string) {
    if (this.stopping || !this.workerEnabled()) return;
    if (this.drainPromise) return this.drainPromise;
    const currentDrain = this.drainAvailable(appcode);
    this.drainPromise = currentDrain;
    try {
      await currentDrain;
    } finally {
      if (this.drainPromise === currentDrain) this.drainPromise = undefined;
    }
  }

  private async drainAvailable(appcode?: string) {
    await this.recoverExpired(appcode);
    while (!this.stopping) {
      const event = await this.claimNext(appcode);
      if (!event) break;
      if (this.stopping) {
        await this.prisma.familyKnowledgeEvent.updateMany({
          where: {
            id: event.id,
            status: 'PROCESSING',
            attemptCount: event.attemptCount,
          },
          data: {
            status: 'QUEUED',
            attemptCount: { decrement: 1 },
            leaseExpiresAt: null,
          },
        });
        break;
      }
      await this.process(event);
    }
  }

  private async claimNext(appcode?: string) {
    for (;;) {
      const candidate = await this.prisma.familyKnowledgeEvent.findFirst({
        where: {
          operation: 'UPSERT',
          status: { in: ['QUEUED', 'RETRY'] },
          ...(appcode ? { appcode } : {}),
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate || this.stopping) return null;
      if (candidate.attemptCount >= candidate.maxAttempts) {
        await this.prisma.familyKnowledgeEvent.updateMany({
          where: {
            id: candidate.id,
            status: candidate.status,
            attemptCount: candidate.attemptCount,
          },
          data: {
            status: 'FAILED',
            resultCode: 'ATTEMPTS_EXHAUSTED',
            errorCode: 'INDEX_ATTEMPTS_EXHAUSTED',
            retryable: false,
            completedAt: new Date(),
            nextAttemptAt: null,
            leaseExpiresAt: null,
          },
        });
        continue;
      }

      const startedAt = new Date();
      const claimed = await this.prisma.familyKnowledgeEvent.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          attemptCount: candidate.attemptCount,
        },
        data: {
          status: 'PROCESSING',
          attemptCount: { increment: 1 },
          retryable: false,
          errorCode: null,
          resultCode: null,
          nextAttemptAt: null,
          leaseExpiresAt: new Date(
            startedAt.getTime() + this.leaseMilliseconds(),
          ),
        },
      });
      if (claimed.count === 1) {
        return {
          ...candidate,
          status: 'PROCESSING' as const,
          attemptCount: candidate.attemptCount + 1,
        };
      }
    }
  }

  private async process(event: {
    id: string;
    appcode: string;
    sourceId: string;
    sourceVersion: number;
    attemptCount: number;
    maxAttempts: number;
  }) {
    const controller = new AbortController();
    this.activeController = controller;
    let renewal: Promise<void> | undefined;
    const owned = () => ({
      id: event.id,
      status: 'PROCESSING' as const,
      attemptCount: event.attemptCount,
      leaseExpiresAt: { gt: new Date() },
    });
    const heartbeat = setInterval(
      () => {
        if (renewal || controller.signal.aborted) return;
        renewal = this.prisma.familyKnowledgeEvent
          .updateMany({
            where: owned(),
            data: {
              leaseExpiresAt: new Date(Date.now() + this.leaseMilliseconds()),
            },
          })
          .then((result) => {
            if (result.count !== 1) {
              controller.abort(new FamilyKnowledgeIndexLeaseLostError());
            }
          })
          .catch(() =>
            controller.abort(new FamilyKnowledgeIndexLeaseLostError()),
          )
          .finally(() => {
            renewal = undefined;
          });
      },
      Math.floor(this.leaseMilliseconds() / 3),
    );
    heartbeat.unref();

    try {
      const resultCode = await this.indexer.indexEvent(
        event,
        controller.signal,
      );
      await this.prisma.familyKnowledgeEvent.updateMany({
        where: owned(),
        data: {
          status: 'SUCCEEDED',
          resultCode,
          completedAt: new Date(),
          leaseExpiresAt: null,
          errorCode: null,
          retryable: false,
          nextAttemptAt: null,
        },
      });
    } catch (error) {
      if (
        error instanceof FamilyKnowledgeIndexLeaseLostError ||
        controller.signal.reason instanceof FamilyKnowledgeIndexLeaseLostError
      ) {
        return;
      }
      const failure = classifyKnowledgeIndexJobError(
        error,
        event.attemptCount,
        this.retryDelayMs(),
      );
      const willRetry =
        failure.retryable && event.attemptCount < event.maxAttempts;
      await this.prisma.familyKnowledgeEvent.updateMany({
        where: owned(),
        data: {
          status: willRetry ? 'RETRY' : 'FAILED',
          resultCode: willRetry ? 'RETRY_SCHEDULED' : 'INDEX_FAILED',
          completedAt: willRetry ? null : new Date(),
          leaseExpiresAt: null,
          errorCode: failure.errorCode,
          retryable: failure.retryable,
          nextAttemptAt: willRetry
            ? new Date(Date.now() + failure.retryAfterMs)
            : null,
        },
      });
    } finally {
      clearInterval(heartbeat);
      await renewal;
      if (this.activeController === controller) {
        this.activeController = undefined;
      }
    }
  }

  private async recoverExpired(appcode?: string) {
    if (this.stopping || !this.workerEnabled()) return;
    await this.prisma.$executeRaw`
      UPDATE "family_knowledge_event" SET
        "status" = CASE
          WHEN "attempt_count" >= "max_attempts" THEN 'FAILED'::"FamilyKnowledgeEventStatus"
          ELSE 'RETRY'::"FamilyKnowledgeEventStatus"
        END,
        "result_code" = CASE
          WHEN "attempt_count" >= "max_attempts" THEN 'ATTEMPTS_EXHAUSTED'
          ELSE 'LEASE_EXPIRED'
        END,
        "error_code" = 'INDEX_LEASE_EXPIRED',
        "retryable" = ("attempt_count" < "max_attempts"),
        "completed_at" = CASE
          WHEN "attempt_count" >= "max_attempts" THEN (clock_timestamp() AT TIME ZONE 'UTC')
          ELSE NULL
        END,
        "lease_expires_at" = NULL,
        "next_attempt_at" = NULL,
        "updated_at" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "operation" = 'UPSERT'
        AND "status" = 'PROCESSING'
        AND "lease_expires_at" <= (clock_timestamp() AT TIME ZONE 'UTC')
        AND (${appcode ?? null}::text IS NULL OR "appcode" = ${appcode ?? null})
    `;
  }

  protected leaseMilliseconds() {
    return LEASE_MILLISECONDS;
  }

  private scheduleDrain() {
    if (this.stopping || !this.workerEnabled()) return;
    if (!this.maintenancePromise) {
      this.maintenancePromise = this.recoverExpired()
        .catch(() => this.logger.error('Family index lease recovery failed.'))
        .finally(() => {
          this.maintenancePromise = undefined;
        });
    }
    void this.drain().catch(() => {
      this.logger.error('Family index worker drain failed.');
    });
  }

  private retryDelayMs() {
    const value = Number(
      this.config.get<string>('KNOWLEDGE_INDEX_RETRY_DELAY_MS') ?? 1000,
    );
    return Number.isInteger(value) && value >= 100 && value <= 60000
      ? value
      : 1000;
  }

  private workerEnabled() {
    return (
      this.config
        .get<string>('FRAME_FAMILY_RAG_ENABLED')
        ?.trim()
        .toLowerCase() === 'true'
    );
  }
}
