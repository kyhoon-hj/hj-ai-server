import {
  calendarMonthUtc,
  FamilyEmbeddingUsageService,
} from './family-embedding-usage.service';

function fixture(limit = '2') {
  type Row = {
    operationKeyHash: string;
    appcode: string;
    periodKey: string;
    state: string;
    [key: string]: unknown;
  };
  const rows: Row[] = [];
  const usage = {
    findUnique: jest.fn(({ where }: { where: { operationKeyHash: string } }) =>
      Promise.resolve(
        rows.find((row) => row.operationKeyHash === where.operationKeyHash) ??
          null,
      ),
    ),
    count: jest.fn(
      ({ where }: { where: { appcode: string; periodKey: string } }) =>
        Promise.resolve(
          rows.filter(
            (row) =>
              row.appcode === where.appcode &&
              row.periodKey === where.periodKey,
          ).length,
        ),
    ),
    create: jest.fn(
      ({
        data,
      }: {
        data: {
          operationKeyHash: string;
          appcode: string;
          periodKey: string;
          [key: string]: unknown;
        };
      }) => {
        rows.push({ ...data, state: 'RESERVED' });
        return Promise.resolve(data);
      },
    ),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { operationKeyHash: string };
        data: Partial<Row>;
      }) => {
        const row = rows.find(
          (item) => item.operationKeyHash === where.operationKeyHash,
        );
        Object.assign(row!, data);
        return Promise.resolve(row);
      },
    ),
  };
  type Transaction = {
    $queryRaw: jest.Mock;
    familyEmbeddingUsage: typeof usage;
  };
  const prisma = {
    $transaction: jest.fn((work: (transaction: Transaction) => unknown) =>
      work({
        $queryRaw: jest.fn().mockResolvedValue([{ locked: '1' }]),
        familyEmbeddingUsage: usage,
      }),
    ),
    familyEmbeddingUsage: usage,
  };
  const service = new FamilyEmbeddingUsageService(
    prisma as never,
    {
      get: jest.fn().mockReturnValue(limit),
    } as never,
  );
  return { service, rows };
}

describe('FamilyEmbeddingUsageService', () => {
  it('uses a UTC calendar month key', () => {
    expect(calendarMonthUtc(new Date('2027-01-01T00:00:00.000Z'))).toBe(
      '2027-01',
    );
  });

  it('reserves atomically, preserves uncertain calls, and blocks the limit', async () => {
    const { service, rows } = fixture();
    await expect(
      service.execute(
        { appcode: 'zinframe', kind: 'INDEX', operationKey: 'one' },
        () => Promise.resolve('ok'),
      ),
    ).resolves.toBe('ok');
    await expect(
      service.execute(
        { appcode: 'zinframe', kind: 'SEARCH', operationKey: 'two' },
        () => Promise.reject(new Error('provider failed')),
      ),
    ).rejects.toThrow('provider failed');
    expect(rows.map((row) => row.state)).toEqual(['SUCCEEDED', 'UNCERTAIN']);
    await expect(
      service.execute(
        { appcode: 'zinframe', kind: 'SEARCH', operationKey: 'three' },
        () => Promise.resolve('not-called'),
      ),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('blocks duplicate operation keys and missing limits before work', async () => {
    const { service } = fixture('1');
    const work = jest.fn().mockResolvedValue('ok');
    await service.execute(
      { appcode: 'zinframe', kind: 'SEARCH', operationKey: 'same' },
      work,
    );
    await expect(
      service.execute(
        { appcode: 'zinframe', kind: 'SEARCH', operationKey: 'same' },
        work,
      ),
    ).rejects.toThrow('FAMILY_EMBEDDING_OPERATION_ALREADY_RESERVED');
    expect(work).toHaveBeenCalledTimes(1);

    const missing = fixture('').service;
    await expect(
      missing.execute(
        { appcode: 'zinframe', kind: 'SEARCH', operationKey: 'new' },
        work,
      ),
    ).rejects.toThrow('FAMILY_EMBEDDING_MONTHLY_LIMIT_REQUIRED');
  });
});
