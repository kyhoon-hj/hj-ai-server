import { Prisma } from '@prisma/client';

export type FamilyKnowledgeIndexLease = { id: string; attemptCount: number };

export class FamilyKnowledgeIndexLeaseLostError extends Error {
  constructor() {
    super('Family knowledge index event lease is no longer owned.');
    this.name = 'FamilyKnowledgeIndexLeaseLostError';
  }
}

export async function assertFamilyKnowledgeIndexLease(
  transaction: Prisma.TransactionClient,
  lease: FamilyKnowledgeIndexLease,
) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "family_knowledge_event"
    WHERE "id" = ${lease.id}::uuid
      AND "attempt_count" = ${lease.attemptCount}
      AND "status" = 'PROCESSING'
      AND "lease_expires_at" > (clock_timestamp() AT TIME ZONE 'UTC')
    FOR UPDATE
  `;
  if (!rows.length) throw new FamilyKnowledgeIndexLeaseLostError();
}
