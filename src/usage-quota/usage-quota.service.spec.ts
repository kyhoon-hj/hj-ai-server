import { ConflictException } from '@nestjs/common';
import { UsageQuotaService } from './usage-quota.service';

type ReservationRow = {
  id: string;
  appcode: string;
  organizationId: string | null;
  periodKey: string;
  operationKeyHash: string;
  operationScope: string;
  tokensReservedAt: Date | null;
  reservedRequests: number;
  reservedTokens: number;
  actualTokens: number | null;
  state: 'RESERVED' | 'SETTLED' | 'UNCERTAIN';
  completedAt: Date | null;
};

function fixture(options?: {
  appTokenLimit?: number | null;
  organizationRequestLimit?: number | null;
  organizationTokenLimit?: number | null;
  measuredRequests?: number;
  measuredTokens?: number;
  unmeasuredRequests?: number;
}) {
  const rows: ReservationRow[] = [];
  let sequence = 0;
  const measured = {
    requests: options?.measuredRequests ?? 0,
    tokens: options?.measuredTokens ?? 0,
    unmeasuredRequests: options?.unmeasuredRequests ?? 0,
  };
  const policy = {
    monthlyTokenLimit:
      options?.appTokenLimit === undefined ? 100 : options.appTokenLimit,
    consoleOwnership: {
      organizationId: '33333333-3333-4333-8333-333333333333',
      organization: {
        monthlyRequestLimit:
          options?.organizationRequestLimit === undefined
            ? 10
            : options.organizationRequestLimit,
        monthlyTokenLimit:
          options?.organizationTokenLimit === undefined
            ? 200
            : options.organizationTokenLimit,
      },
    },
  };
  const reservation = {
    findUnique: jest.fn(({ where }: { where: Record<string, string> }) => {
      const row = rows.find((candidate) =>
        where.id
          ? candidate.id === where.id
          : candidate.operationKeyHash === where.operationKeyHash,
      );
      return Promise.resolve(row ?? null);
    }),
    create: jest.fn(
      ({
        data,
      }: {
        data: Omit<
          ReservationRow,
          | 'id'
          | 'reservedRequests'
          | 'reservedTokens'
          | 'actualTokens'
          | 'state'
          | 'completedAt'
          | 'tokensReservedAt'
        >;
      }) => {
        const row: ReservationRow = {
          id: `reservation-${++sequence}`,
          ...data,
          reservedRequests: 1,
          reservedTokens: 0,
          actualTokens: null,
          state: 'RESERVED',
          completedAt: null,
          tokensReservedAt: null,
        };
        rows.push(row);
        return Promise.resolve(row);
      },
    ),
    aggregate: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      const active = rows.filter(
        (row) =>
          row.periodKey === where.periodKey &&
          (where.appcode
            ? row.appcode === where.appcode
            : row.organizationId === where.organizationId) &&
          (row.state === 'RESERVED' || row.state === 'UNCERTAIN'),
      );
      return Promise.resolve({
        _sum: {
          reservedRequests: active.reduce(
            (sum, row) => sum + row.reservedRequests,
            0,
          ),
          reservedTokens: active.reduce(
            (sum, row) => sum + row.reservedTokens,
            0,
          ),
        },
      });
    }),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<ReservationRow>;
      }) => {
        const row = rows.find((candidate) => candidate.id === where.id)!;
        Object.assign(
          row,
          Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined),
          ),
        );
        return Promise.resolve(row);
      },
    ),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: {
          id: string;
          state: string | { in: string[] };
          reservedRequests?: number;
        };
        data: Partial<ReservationRow>;
      }) => {
        const row = rows.find(
          (candidate) =>
            candidate.id === where.id &&
            (typeof where.state === 'string'
              ? candidate.state === where.state
              : where.state.in.includes(candidate.state)) &&
            (where.reservedRequests === undefined ||
              candidate.reservedRequests === where.reservedRequests),
        );
        if (row)
          Object.assign(
            row,
            Object.fromEntries(
              Object.entries(data).filter(([, value]) => value !== undefined),
            ),
          );
        return Promise.resolve({ count: row ? 1 : 0 });
      },
    ),
  };
  const transaction = {
    appInfo: { findUnique: jest.fn().mockResolvedValue(policy) },
    consoleUsageReservation: reservation,
    $queryRaw: jest.fn((query: { strings?: string[] }) => {
      const sql = query.strings?.join(' ') ?? '';
      return Promise.resolve(
        sql.includes('usage_events AS')
          ? [
              {
                requests: measured.requests,
                tokens: measured.tokens,
                unmeasuredRequests: measured.unmeasuredRequests,
              },
            ]
          : [{ locked: '1' }],
      );
    }),
  };
  let queue = Promise.resolve();
  const prisma = {
    consoleUsageReservation: reservation,
    $transaction: jest.fn(<T>(work: (tx: typeof transaction) => Promise<T>) => {
      const result = queue.then(async () => {
        const beforeRows = rows.map((row) => ({ ...row }));
        const beforeMeasured = { ...measured };
        try {
          return await work(transaction);
        } catch (error) {
          rows.splice(0, rows.length, ...beforeRows);
          Object.assign(measured, beforeMeasured);
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
    service: new UsageQuotaService(prisma as never),
    rows,
    measured,
    transaction,
    prisma,
  };
}

describe('UsageQuotaService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-17T03:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('enforces the organization boundary in the serialized transaction mock', async () => {
    const { service, rows } = fixture({ organizationRequestLimit: 1 });

    const results = await Promise.allSettled([
      service.begin({ appcode: 'APP', operationKey: 'one' }),
      service.begin({ appcode: 'APP', operationKey: 'two' }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(rows).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('rejects duplicate operation keys in the transaction mock', async () => {
    const { service } = fixture();
    await service.begin({ appcode: 'APP', operationKey: 'same' });

    await expect(
      service.begin({ appcode: 'APP', operationKey: 'same' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('includes active and uncertain reservations in token limits', async () => {
    const { service } = fixture({ appTokenLimit: 100 });
    const first = await service.begin({ appcode: 'APP', operationKey: 'one' });
    await service.reserveTokens(first, 60);
    await service.markUncertain(first);
    const second = await service.begin({ appcode: 'APP', operationKey: 'two' });

    await expect(service.reserveTokens(second, 41)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('settles actual usage after the durable execution log is written', async () => {
    const { service, rows } = fixture();
    const current = await service.begin({
      appcode: 'APP',
      operationKey: 'settled',
    });
    await service.reserveTokens(current, 80);
    await service.settle(current, 23);

    expect(rows[0]).toMatchObject({
      state: 'SETTLED',
      reservedTokens: 80,
      actualTokens: 23,
    });
    expect(rows[0]?.completedAt).toBeInstanceOf(Date);
  });

  it('does not create reservation rows when no limit applies', async () => {
    const { service, rows } = fixture({
      appTokenLimit: null,
      organizationRequestLimit: null,
      organizationTokenLimit: null,
    });

    await expect(
      service.begin({ appcode: 'APP', operationKey: 'unlimited' }),
    ).resolves.toBeNull();
    expect(rows).toHaveLength(0);
  });
  it.each(['RESERVED', 'UNCERTAIN'] as const)(
    'counts a logged request once while token state is %s',
    async (state) => {
      const { service, rows, measured, transaction } = fixture({
        organizationRequestLimit: 2,
      });
      const first = await service.begin({
        appcode: 'APP',
        operationKey: 'first',
      });
      await service.reserveTokens(first, 60);
      if (state === 'UNCERTAIN') await service.markUncertain(first);
      await service.recordUsage(first, (tx) => {
        expect(tx).toBe(transaction);
        measured.requests++;
        return Promise.resolve('failure-log');
      });
      expect(rows[0]).toMatchObject({
        state,
        reservedRequests: 0,
        reservedTokens: 60,
      });
      const second = await service.begin({
        appcode: 'APP',
        operationKey: 'second',
      });
      await expect(service.reserveTokens(second, 41)).rejects.toMatchObject({
        status: 429,
      });
      await expect(
        service.begin({ appcode: 'APP', operationKey: 'third' }),
      ).rejects.toMatchObject({ status: 429 });
    },
  );

  it('keeps unlogged uncertain requests counted', async () => {
    const { service, rows } = fixture({ organizationRequestLimit: 1 });
    const first = await service.begin({
      appcode: 'APP',
      operationKey: 'first',
    });
    await service.markUncertain(first);
    expect(rows[0].reservedRequests).toBe(1);
    await expect(
      service.begin({ appcode: 'APP', operationKey: 'second' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('rolls back a failed log write and allows a later transfer', async () => {
    const { service, rows, measured } = fixture();
    const first = await service.begin({
      appcode: 'APP',
      operationKey: 'first',
    });
    await service.reserveTokens(first, 60);
    await expect(
      service.recordUsage(first, () => {
        measured.requests++;
        return Promise.reject(new Error('log failed'));
      }),
    ).rejects.toThrow('log failed');
    expect(rows[0]).toMatchObject({ reservedRequests: 1, reservedTokens: 60 });
    expect(measured.requests).toBe(0);
    await service.recordUsage(first, () =>
      Promise.resolve(measured.requests++),
    );
    expect(rows[0].reservedRequests).toBe(0);
    expect(measured.requests).toBe(1);
  });

  it('rejects a repeated transfer before creating another log', async () => {
    const { service } = fixture();
    const first = await service.begin({
      appcode: 'APP',
      operationKey: 'first',
    });
    const write = jest.fn().mockResolvedValue('log');
    await service.recordUsage(first, write);
    await expect(service.recordUsage(first, write)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not write a log if the request transfer fails', async () => {
    const { service, transaction, rows } = fixture();
    const first = await service.begin({
      appcode: 'APP',
      operationKey: 'first',
    });
    transaction.consoleUsageReservation.updateMany.mockRejectedValueOnce(
      new Error('transfer failed'),
    );
    const write = jest.fn();
    await expect(service.recordUsage(first, write)).rejects.toThrow(
      'transfer failed',
    );
    expect(write).not.toHaveBeenCalled();
    expect(rows[0].reservedRequests).toBe(1);
  });

  it('takes the same organization/app locks before writing the log', async () => {
    const { service, transaction } = fixture();
    const first = await service.begin({
      appcode: 'APP',
      operationKey: 'first',
    });
    const admissionLocks = transaction.$queryRaw.mock.calls.slice(0, 2);
    transaction.$queryRaw.mockClear();
    await service.recordUsage(first, () => {
      expect(transaction.$queryRaw.mock.calls).toEqual(admissionLocks);
      return Promise.resolve();
    });
  });

  it('writes unlimited usage without a reservation transaction', async () => {
    const { service, prisma } = fixture();
    const write = jest.fn().mockResolvedValue('log');
    await expect(service.recordUsage(null, write)).resolves.toBe('log');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(prisma);
  });

  it('does not recount a logged request after settlement fails', async () => {
    const { service, transaction, measured, rows } = fixture({
      organizationRequestLimit: 2,
    });
    const first = await service.begin({
      appcode: 'APP',
      operationKey: 'first',
    });
    await service.reserveTokens(first, 60);
    await service.recordUsage(first, () =>
      Promise.resolve(measured.requests++),
    );
    transaction.consoleUsageReservation.updateMany.mockRejectedValueOnce(
      new Error('settlement failed'),
    );
    await expect(service.settle(first, 15)).rejects.toThrow(
      'settlement failed',
    );
    expect(rows[0]).toMatchObject({
      state: 'RESERVED',
      reservedRequests: 0,
      reservedTokens: 60,
    });
    await expect(
      service.begin({ appcode: 'APP', operationKey: 'second' }),
    ).resolves.toBeTruthy();
  });
  it('persists the durable log reference in the request-transfer transaction', async () => {
    const { service, rows, transaction } = fixture();
    const first = await service.begin({
      appcode: 'APP',
      operationKey: 'first',
    });
    const write = jest.fn().mockResolvedValue({ id: 'log-id' });
    await service.recordUsage(first, write, 'knowledge');
    expect(write).toHaveBeenCalledWith(transaction);
    expect(rows[0]).toMatchObject({
      reservedRequests: 0,
      usageLogSource: 'knowledge',
      usageLogId: 'log-id',
    });
  });

  it('rolls back the log and request transfer if the durable reference cannot be stored', async () => {
    const { service, rows, transaction, measured } = fixture();
    const first = await service.begin({
      appcode: 'APP',
      operationKey: 'first',
    });
    transaction.consoleUsageReservation.update.mockRejectedValueOnce(
      new Error('reference failed'),
    );
    await expect(
      service.recordUsage(
        first,
        () => {
          measured.requests++;
          return Promise.resolve({ id: 'log-id' });
        },
        'bedrock',
      ),
    ).rejects.toThrow('reference failed');
    expect(rows[0].reservedRequests).toBe(1);
    expect(measured.requests).toBe(0);
  });

  it('includes recovery requests and tokens in the durable usage query', async () => {
    const { service, transaction } = fixture();
    await service.begin({ appcode: 'APP', operationKey: 'first' });
    const sql = transaction.$queryRaw.mock.calls
      .map(([query]) => query.strings?.join(' '))
      .join(' ');
    expect(sql).toContain('reservation.recovery_requests AS requests');
    expect(sql).toContain('reservation.recovery_tokens AS tokens');
    expect(sql).toContain('COALESCE(SUM(source.requests), 0)');
  });
  it('captures the UTC month after waiting for the quota lock', async () => {
    jest.setSystemTime(new Date('2026-09-30T23:59:59.999Z'));
    const { service, transaction } = fixture();
    transaction.$queryRaw.mockImplementationOnce(() => {
      jest.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
      return Promise.resolve([{ locked: '1' }]);
    });
    await expect(
      service.begin({ appcode: 'APP', operationKey: 'first' }),
    ).resolves.toMatchObject({ periodKey: '2026-10' });
  });

  it('scopes duplicates by app, UTC month and operation namespace', async () => {
    const { service } = fixture({ organizationRequestLimit: 20 });
    const input = {
      appcode: 'APP',
      operationKey: 'shared-id',
      operationScope: 'knowledge.answer',
    };
    await service.begin(input);
    await expect(service.begin(input)).rejects.toMatchObject({ status: 409 });
    await expect(
      service.begin({ ...input, operationScope: 'bedrock.general-answers' }),
    ).resolves.toBeTruthy();
    await expect(
      service.begin({ ...input, appcode: 'OTHER' }),
    ).resolves.toBeTruthy();
    jest.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    await expect(service.begin(input)).resolves.toMatchObject({
      periodKey: '2026-10',
    });
  });

  it('keeps legacy duplicate protection during an in-month upgrade', async () => {
    const { service } = fixture();
    await service.begin({ appcode: 'APP', operationKey: 'shared-id' });
    await expect(
      service.begin({
        appcode: 'APP',
        operationKey: 'shared-id',
        operationScope: 'knowledge.answer',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a second zero-token reservation', async () => {
    const { service } = fixture();
    const current = await service.begin({
      appcode: 'APP',
      operationKey: 'zero',
    });
    await service.reserveTokens(current, 0);
    await expect(service.reserveTokens(current, 0)).rejects.toThrow(
      'USAGE_QUOTA_TOKENS_ALREADY_RESERVED',
    );
  });

  it('treats a zero request limit as no admitted requests', async () => {
    const { service, rows } = fixture({ organizationRequestLimit: 0 });
    await expect(
      service.begin({ appcode: 'APP', operationKey: 'zero' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(rows).toHaveLength(0);
  });

  it.each(['app', 'organization'] as const)(
    'enforces zero %s tokens while permitting a measured zero outcome',
    async (scope) => {
      const { service } = fixture(
        scope === 'app' ? { appTokenLimit: 0 } : { organizationTokenLimit: 0 },
      );
      const current = await service.begin({
        appcode: 'APP',
        operationKey: 'zero',
      });
      await expect(service.reserveTokens(current, 1)).rejects.toMatchObject({
        status: 429,
      });
      await expect(service.reserveTokens(current, 0)).resolves.toBeUndefined();
    },
  );

  it('accepts the exact token boundary and rejects one extra token', async () => {
    const { service } = fixture({ appTokenLimit: 100, measuredTokens: 40 });
    const first = await service.begin({
      appcode: 'APP',
      operationKey: 'first',
    });
    await service.reserveTokens(first, 60);
    const second = await service.begin({
      appcode: 'APP',
      operationKey: 'second',
    });
    await expect(service.reserveTokens(second, 1)).rejects.toMatchObject({
      status: 429,
    });
  });

  it.each([20, 120])(
    'replaces the estimate with %i measured tokens atomically, even before settlement',
    async (actualTokens) => {
      const { service, rows, measured, transaction } = fixture({
        appTokenLimit: 100,
        organizationRequestLimit: 20,
      });
      const first = await service.begin({
        appcode: 'APP',
        operationKey: 'first',
      });
      await service.reserveTokens(first, 80);
      await service.recordUsage(
        first,
        () => {
          measured.requests++;
          measured.tokens += actualTokens;
          return Promise.resolve({ id: 'log-id', totaltokens: actualTokens });
        },
        'bedrock',
      );
      expect(rows[0]).toMatchObject({
        reservedTokens: 0,
        actualTokens,
        state: 'RESERVED',
      });
      transaction.consoleUsageReservation.updateMany.mockRejectedValueOnce(
        new Error('settlement failed'),
      );
      await expect(service.settle(first, actualTokens)).rejects.toThrow(
        'settlement failed',
      );
      const next = await service.begin({
        appcode: 'APP',
        operationKey: 'next',
      });
      if (actualTokens === 20)
        await expect(service.reserveTokens(next, 80)).resolves.toBeUndefined();
      else
        await expect(service.reserveTokens(next, 1)).rejects.toMatchObject({
          status: 429,
        });
    },
  );

  it('retains the estimate for a logged but unmeasured generation', async () => {
    const { service, rows } = fixture();
    const current = await service.begin({
      appcode: 'APP',
      operationKey: 'unknown',
    });
    await service.reserveTokens(current, 80);
    await service.recordUsage(
      current,
      () => Promise.resolve({ id: 'log-id', totaltokens: null }),
      'bedrock',
    );
    await service.markUncertain(current);
    expect(rows[0]).toMatchObject({
      reservedRequests: 0,
      reservedTokens: 80,
      actualTokens: null,
      state: 'UNCERTAIN',
    });
  });

  it('fails closed for token limits when historical usage has no measurement or reservation', async () => {
    const { service } = fixture({ unmeasuredRequests: 1 });
    const current = await service.begin({
      appcode: 'APP',
      operationKey: 'unknown',
    });
    await expect(service.reserveTokens(current, 1)).rejects.toThrow(
      'USAGE_QUOTA_USAGE_UNMEASURED',
    );
    const requestOnly = fixture({
      appTokenLimit: null,
      organizationTokenLimit: null,
      unmeasuredRequests: 1,
    });
    const request = await requestOnly.service.begin({
      appcode: 'APP',
      operationKey: 'allowed',
    });
    await expect(
      requestOnly.service.reserveTokens(request, 100),
    ).resolves.toBeUndefined();
  });

  it.each([-1, 0.5, NaN, Infinity, 2147483648])(
    'rejects invalid token counts %s',
    async (tokens) => {
      const { service } = fixture();
      const current = await service.begin({
        appcode: 'APP',
        operationKey: 'invalid',
      });
      await expect(
        service.reserveTokens(current, tokens),
      ).rejects.toMatchObject({ status: 503 });
      await expect(service.settle(current, tokens)).rejects.toMatchObject({
        status: 503,
      });
    },
  );

  it('uses linked reservation month/organization instead of completion time/current ownership', async () => {
    const { service, transaction } = fixture();
    await service.begin({ appcode: 'APP', operationKey: 'first' });
    const sql = transaction.$queryRaw.mock.calls
      .map(([query]) => query.strings?.join(' '))
      .join(' ');
    expect(sql).toContain(
      "ELSE (reservation.period_key || '-01')::timestamp END AS occurred_at",
    );
    expect(sql).toContain(
      'ELSE reservation.organization_id END AS organization_id',
    );
    expect(sql).toContain(
      'reservation.usage_log_source = log.source_type AND reservation.usage_log_id = log.id',
    );
  });
});
