import { Prisma } from '@prisma/client';

export type KnowledgeIndexLease = { id: string; attempt: number };

export class KnowledgeIndexLeaseLostError extends Error {
  constructor() {
    super('Knowledge index job lease is no longer owned.');
    this.name = 'KnowledgeIndexLeaseLostError';
  }
}

export async function assertKnowledgeIndexLease(
  transaction: Prisma.TransactionClient,
  lease?: KnowledgeIndexLease,
) {
  if (!lease) return;
  // Hold the job row lock until the file/chunk transaction commits. A reclaimer
  // cannot hand the job to a new attempt while this attempt publishes its data.
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM knowledge_index_job
    WHERE id = ${lease.id}::uuid AND attempt = ${lease.attempt}
      AND status = 'processing' AND lease_expires_at > (clock_timestamp() AT TIME ZONE 'UTC')
    FOR UPDATE
  `;
  if (!rows.length) throw new KnowledgeIndexLeaseLostError();
}
