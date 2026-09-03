import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from './knowledge.service';
import { classifyKnowledgeIndexJobError } from './knowledge-index-job-error';
import { abortAllAwsRequests } from '../common/aws/aws-request-control';

const ACTIVE_JOB_STATUSES = ['queued', 'processing'];
const LEASE_MILLISECONDS = 5 * 60 * 1000;

@Injectable()
export class KnowledgeIndexJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeIndexJobService.name);
  private timer?: NodeJS.Timeout;
  private drainPromise?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeService: KnowledgeService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    if (!this.workerEnabled()) return;
    await this.prisma.knowledgeIndexJob.updateMany({
      where: { status: 'processing', leaseExpiresAt: { lt: new Date() } },
      data: {
        status: 'queued',
        leaseExpiresAt: null,
        startedAt: null,
        nextAttemptAt: null,
      },
    });
    this.timer = setInterval(() => this.scheduleDrain(), 500);
    this.timer.unref();
    this.scheduleDrain();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    abortAllAwsRequests();
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
    for (;;) {
      const job = await this.claimNext(appcode);
      if (!job) break;
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
      if (!candidate) return null;
      const startedAt = new Date();
      const claimed = await this.prisma.knowledgeIndexJob.updateMany({
        where: { id: candidate.id, status: 'queued' },
        data: {
          status: 'processing',
          attempt: { increment: 1 },
          startedAt,
          leaseExpiresAt: new Date(startedAt.getTime() + LEASE_MILLISECONDS),
          nextAttemptAt: null,
        },
      });
      if (claimed.count === 1) {
        return this.prisma.knowledgeIndexJob.findUnique({
          where: { id: candidate.id },
        });
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
    try {
      const app = await this.prisma.appInfo.findUnique({
        where: { appcode: job.appcode },
        select: { appcode: true, defaultEmbeddingModelId: true },
      });
      if (!app) throw new Error(`AppInfo ${job.appcode} not found`);
      await this.knowledgeService.indexKnowledgeFile(job.fileId, app);
      await this.prisma.knowledgeIndexJob.update({
        where: { id: job.id },
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
      const failure = classifyKnowledgeIndexJobError(
        error,
        job.attempt,
        this.retryDelayMs(),
      );
      const willRetry = failure.retryable && job.attempt < job.maxAttempts;
      await this.prisma.knowledgeIndexJob.update({
        where: { id: job.id },
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
    }
  }

  private scheduleDrain() {
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
