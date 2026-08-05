import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('appcode uniqueness migration preflight', () => {
  it('checks for duplicates before creating the unique index', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma',
        'migrations',
        '20260718060000_add_rag_contract_baseline',
        'migration.sql',
      ),
      'utf8',
    );
    const duplicateCheck = sql.indexOf('HAVING COUNT(*) > 1');
    const uniqueIndex = sql.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS "appinfo_appcode_key"',
    );

    expect(duplicateCheck).toBeGreaterThan(-1);
    expect(uniqueIndex).toBeGreaterThan(duplicateCheck);
    expect(sql).toContain('RAISE EXCEPTION');
  });
});
