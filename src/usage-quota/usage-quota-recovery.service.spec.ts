import {
  conversationQuotaScope,
  usageOperationHash,
} from './usage-quota-policy';
import { createHash } from 'node:crypto';
import { ConsoleUsageReservation, Prisma } from '@prisma/client';
import { UsageQuotaRecoveryService } from './usage-quota-recovery.service';
import { ReconcileUsageReservationDto } from './usage-quota-recovery.dto';
import { UsageQuotaService } from './usage-quota.service';

const id = '11111111-1111-4111-8111-111111111111';
const logId = '22222222-2222-4222-8222-222222222222';
const recoveryKey = '33333333-3333-4333-8333-333333333333';
const at = new Date('2026-09-18T01:00:00Z');
const actor = {
  credentialSlot: 'primary' as const,
  requestId: 'operator-request',
};
const command = (
  overrides: Partial<ReconcileUsageReservationDto> = {},
): ReconcileUsageReservationDto => ({
  recoveryKey,
  expectedUpdatedAt: at.toISOString(),
  action: 'CONFIRM_USAGE',
  executorStopped: true,
  evidenceRef: 'INC-123',
  actualTokens: 25,
  ...overrides,
});

function fixture(overrides: Partial<ConsoleUsageReservation> = {}) {
  let row: ConsoleUsageReservation = {
    id,
    operationScope: 'legacy',
    tokensReservedAt: null,
    appcode: 'APP',
    organizationId: null,
    periodKey: '2026-09',
    operationKeyHash: 'hash',
    reservedRequests: 1,
    reservedTokens: 80,
    actualTokens: null,
    state: 'UNCERTAIN',
    usageLogSource: null,
    usageLogId: null,
    recoveryRequests: 0,
    recoveryTokens: 0,
    recoveryKey: null,
    recoveryHash: null,
    completedAt: at,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
  const audits: unknown[] = [];
  const log = {
    appcode: 'APP',
    searchat: at,
    createdAt: at,
    totaltokens: 25,
    totalTokens: 25,
    requestId: null,
  };
  const logs = jest.fn().mockResolvedValue(log);
  const reservation = {
    findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...row })),
    findUniqueOrThrow: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ ...row })),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: { state: string; updatedAt?: Date };
        data: Partial<ConsoleUsageReservation>;
      }) => {
        if (
          where.state !== row.state ||
          (where.updatedAt &&
            where.updatedAt.getTime() !== row.updatedAt.getTime())
        )
          return Promise.resolve({ count: 0 });
        row = { ...row, ...data, updatedAt: new Date() };
        return Promise.resolve({ count: 1 });
      },
    ),
  };
  const tx = {
    consoleUsageReservation: reservation,
    securityAuditEvent: {
      create: jest.fn((data: unknown) => {
        audits.push(data);
        return Promise.resolve({});
      }),
    },
    bedrockSearchLog: { findUnique: logs },
    knowledgeQueryLog: { findUnique: logs },
    familyConversationMetric: { findUnique: logs },
    $queryRaw: jest.fn().mockResolvedValue([{ locked: '1' }]),
  };
  let queue = Promise.resolve();
  const prisma = {
    consoleUsageReservation: reservation,
    $transaction: jest.fn(<T>(work: (transaction: typeof tx) => Promise<T>) => {
      const result = queue.then(async () => {
        const before = { ...row };
        const auditCount = audits.length;
        try {
          return await work(tx);
        } catch (error) {
          row = before;
          audits.splice(auditCount);
          throw error;
        }
      });
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
  };
  return {
    service: new UsageQuotaRecoveryService(prisma as never),
    quota: new UsageQuotaService(prisma as never),
    tx,
    logs,
    log,
    audits,
    getRow: () => row,
  };
}

describe('Usage quota recovery (transaction mock, no live database)', () => {
  beforeEach(() =>
    jest.useFakeTimers().setSystemTime(new Date('2026-09-18T02:00:00Z')),
  );
  afterEach(() => jest.useRealTimers());

  it.each(['RESERVED', 'UNCERTAIN'] as const)(
    'recovers confirmed unlogged usage from %s and retains it in the quota ledger',
    async (state) => {
      const { service, audits } = fixture({ state });
      const result = await service.reconcile(id, command(), actor);
      expect(result).toMatchObject({
        state: 'SETTLED',
        actualTokens: 25,
        recoveryRequests: 1,
        recoveryTokens: 25,
        reservedRequests: 0,
        reservedTokens: 0,
        recoveryKey,
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        data: {
          eventType: 'USAGE_QUOTA_RESERVATION_RECOVERED',
          metadata: { previousState: state, evidenceRef: 'INC-123' },
        },
      });
    },
  );

  it('returns the same result on concurrent identical retries with one audit', async () => {
    const { service, audits } = fixture();
    const results = await Promise.all([
      service.reconcile(id, command(), actor),
      service.reconcile(id, command(), actor),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(audits).toHaveLength(1);
    await expect(
      service.reconcile(id, command({ actualTokens: 26 }), actor),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.reconcile(id, command({ recoveryKey: logId }), actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('releases only a confirmed unexecuted and unlogged reservation', async () => {
    const { service } = fixture({ state: 'RESERVED' });
    await expect(
      service.reconcile(
        id,
        command({ action: 'RELEASE', actualTokens: undefined }),
        actor,
      ),
    ).resolves.toMatchObject({
      actualTokens: 0,
      recoveryRequests: 0,
      recoveryTokens: 0,
      state: 'SETTLED',
    });
  });

  it.each(['bedrock', 'knowledge', 'conversation'])(
    'settles a durable %s log without adding its usage again',
    async (source) => {
      const { service, logs } = fixture({
        usageLogSource: source,
        usageLogId: logId,
        reservedRequests: 0,
        state: 'RESERVED',
      });
      await expect(
        service.reconcile(
          id,
          command({ action: 'SETTLE_LOG', actualTokens: undefined }),
          actor,
        ),
      ).resolves.toMatchObject({
        actualTokens: 25,
        recoveryRequests: 0,
        recoveryTokens: 0,
        usageLogId: logId,
      });
      expect(logs).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.objectContaining({
            question: true,
            searchword: true,
            response: true,
          }) as unknown,
        }),
      );
    },
  );

  it('requires evidence for unmeasured logged tokens and records only the missing tokens', async () => {
    const { service, logs, log } = fixture({
      usageLogSource: 'bedrock',
      usageLogId: logId,
      reservedRequests: 0,
    });
    logs.mockResolvedValue({ ...log, totaltokens: null });
    await expect(
      service.reconcile(
        id,
        command({ action: 'SETTLE_LOG', actualTokens: undefined }),
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.reconcile(
        id,
        command({ action: 'SETTLE_LOG', actualTokens: 40 }),
        actor,
      ),
    ).resolves.toMatchObject({
      recoveryRequests: 0,
      recoveryTokens: 40,
      actualTokens: 40,
    });
  });

  it('reconciles a legacy request against an explicitly supplied log', async () => {
    const { service } = fixture();
    await expect(
      service.reconcile(
        id,
        command({ action: 'SETTLE_LOG', logSource: 'bedrock', logId }),
        actor,
      ),
    ).resolves.toMatchObject({
      usageLogSource: 'bedrock',
      usageLogId: logId,
      recoveryRequests: 0,
    });
  });

  it.each([{ appcode: 'OTHER' }, { totaltokens: 30 }])(
    'rejects mismatched log evidence %j',
    async (change) => {
      const { service, logs, log, audits } = fixture({
        usageLogSource: 'bedrock',
        usageLogId: logId,
      });
      logs.mockResolvedValue({ ...log, ...change });
      await expect(
        service.reconcile(id, command({ action: 'SETTLE_LOG' }), actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(audits).toHaveLength(0);
    },
  );

  it('checks the request identity for legacy knowledge logs', async () => {
    const requestId = 'original-request';
    const operationKeyHash = createHash('sha256')
      .update(JSON.stringify(['APP', '2026-09', requestId]))
      .digest('hex');
    const { service, logs, log } = fixture({ operationKeyHash });
    logs.mockResolvedValue({ ...log, requestId: 'another-request' });
    const input = command({
      action: 'SETTLE_LOG',
      logSource: 'knowledge',
      logId,
    });
    await expect(service.reconcile(id, input, actor)).rejects.toMatchObject({
      status: 409,
    });
    logs.mockResolvedValue({ ...log, requestId });
    await expect(service.reconcile(id, input, actor)).resolves.toMatchObject({
      state: 'SETTLED',
    });
  });

  it.each([
    { updatedAt: new Date('2026-09-18T01:59:00Z') },
    { state: 'SETTLED' as const },
    { updatedAt: new Date('2026-09-18T00:59:00Z') },
  ])('rejects fresh, already settled, or changed snapshots %j', async (row) => {
    const { service, audits } = fixture(row);
    await expect(service.reconcile(id, command(), actor)).rejects.toMatchObject(
      { status: 409 },
    );
    expect(audits).toHaveLength(0);
  });

  it('requires the executor to be stopped even for an old reservation', async () => {
    const { service } = fixture();
    await expect(
      service.reconcile(
        id,
        command({ executorStopped: false as never }),
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each(['RELEASE', 'CONFIRM_USAGE'] as const)(
    'refuses %s when a log has already been recorded',
    async (action) => {
      const { service } = fixture({ reservedRequests: 0 });
      await expect(
        service.reconcile(id, command({ action }), actor),
      ).rejects.toMatchObject({ status: 409 });
    },
  );

  it('rolls back the recovery when audit persistence fails, then permits a retry', async () => {
    const { service, tx, getRow, audits } = fixture();
    tx.securityAuditEvent.create.mockRejectedValueOnce(
      new Error('audit unavailable'),
    );
    await expect(service.reconcile(id, command(), actor)).rejects.toThrow(
      'audit unavailable',
    );
    expect(getRow()).toMatchObject({
      state: 'UNCERTAIN',
      recoveryKey: null,
      reservedRequests: 1,
    });
    expect(audits).toHaveLength(0);
    await service.reconcile(id, command(), actor);
    expect(audits).toHaveLength(1);
  });

  it('translates duplicate log/recovery keys into a conflict', async () => {
    const { service, tx } = fixture();
    tx.consoleUsageReservation.updateMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.reconcile(id, command(), actor)).rejects.toMatchObject(
      { status: 409 },
    );
  });

  it('prevents a late worker from overwriting the recovered token total', async () => {
    const { service, quota, getRow } = fixture();
    const recovered = await service.reconcile(id, command(), actor);
    await expect(quota.settle(recovered, 99)).rejects.toMatchObject({
      status: 409,
    });
    await expect(quota.markUncertain(recovered)).rejects.toMatchObject({
      status: 409,
    });
    await expect(quota.settle(recovered, 25)).resolves.toBeUndefined();
    expect(getRow().actualTokens).toBe(25);
  });

  it('lists bounded stale reservations with keyset pagination and scoped filters', async () => {
    const { service, tx, getRow } = fixture();
    tx.consoleUsageReservation.findMany.mockResolvedValue([
      getRow(),
      { ...getRow(), id: logId },
    ] as never);
    await expect(
      service.list({
        appcode: 'APP',
        periodKey: '2026-09',
        after: recoveryKey,
        limit: 1,
      }),
    ).resolves.toMatchObject({ items: [{ id }], nextCursor: id });
    expect(tx.consoleUsageReservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          appcode: 'APP',
          periodKey: '2026-09',
          id: { gt: recoveryKey },
          state: { in: ['RESERVED', 'UNCERTAIN'] },
          updatedAt: { lte: new Date('2026-09-18T01:45:00Z') },
        }) as unknown,
        take: 2,
      }),
    );
  });

  it('reports a missing reservation without a mutation', async () => {
    const { service, tx } = fixture();
    tx.consoleUsageReservation.findUnique.mockResolvedValueOnce(null);
    await expect(service.get(id)).rejects.toMatchObject({ status: 404 });
    tx.consoleUsageReservation.findUnique.mockResolvedValueOnce(null);
    await expect(service.reconcile(id, command(), actor)).rejects.toMatchObject(
      { status: 404 },
    );
    expect(tx.consoleUsageReservation.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a fresh reservation even when the supplied snapshot matches', async () => {
    const updatedAt = new Date('2026-09-18T01:59:00Z');
    const { service } = fixture({ updatedAt });
    await expect(
      service.reconcile(
        id,
        command({ expectedUpdatedAt: updatedAt.toISOString() }),
        actor,
      ),
    ).rejects.toThrow('USAGE_QUOTA_EXECUTOR_NOT_QUIESCED');
  });

  it('does not commit when the conditional state update loses a race', async () => {
    const { service, tx, audits } = fixture();
    tx.consoleUsageReservation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.reconcile(id, command(), actor)).rejects.toThrow(
      'USAGE_QUOTA_RESERVATION_CHANGED',
    );
    expect(audits).toHaveLength(0);
  });
  it('recovers a linked log completed in the next UTC month against the original reservation', async () => {
    const { service, logs, log } = fixture({
      usageLogSource: 'bedrock',
      usageLogId: logId,
    });
    logs.mockResolvedValue({
      ...log,
      searchat: new Date('2026-10-01T00:00:01Z'),
    });
    await expect(
      service.reconcile(id, command({ action: 'SETTLE_LOG' }), actor),
    ).resolves.toMatchObject({
      periodKey: '2026-09',
      actualTokens: 25,
      recoveryTokens: 0,
    });
  });

  it('still rejects a cross-month legacy log without a durable link', async () => {
    const { service, logs, log } = fixture();
    logs.mockResolvedValue({
      ...log,
      searchat: new Date('2026-10-01T00:00:01Z'),
    });
    await expect(
      service.reconcile(
        id,
        command({ action: 'SETTLE_LOG', logSource: 'bedrock', logId }),
        actor,
      ),
    ).rejects.toThrow('USAGE_QUOTA_LOG_SCOPE_MISMATCH');
  });

  it('verifies a scoped conversation identity during recovery', async () => {
    const operationScope = conversationQuotaScope('tenant', 'session');
    const requestId = 'request-id';
    const { service, logs, log } = fixture({
      operationScope,
      operationKeyHash: usageOperationHash(
        'APP',
        '2026-09',
        requestId,
        operationScope,
      ),
      usageLogSource: 'conversation',
      usageLogId: logId,
    });
    logs.mockResolvedValue({ ...log, requestId });
    await expect(
      service.reconcile(id, command({ action: 'SETTLE_LOG' }), actor),
    ).resolves.toMatchObject({ state: 'SETTLED' });
  });
});
