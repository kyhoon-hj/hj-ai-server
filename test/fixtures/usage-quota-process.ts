import { PrismaService } from '../../src/prisma/prisma.service';
import { UsageQuotaService } from '../../src/usage-quota/usage-quota.service';

export type QuotaProcessCommand = {
  appcode: string;
  operationKey: string;
  tokens?: number;
  hold?: 'after-reserve' | 'during-log' | 'after-log';
};

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.RUN_USAGE_QUOTA_DB !== 'true' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/queue_e2e_[a-f0-9]{32}$/.test(url.pathname)
  )
    throw new Error('Isolated quota database required');
  const prisma = new PrismaService();
  await prisma.$connect();
  const quota = new UsageQuotaService(prisma);
  const [backend] = await prisma.$queryRaw<
    Array<{ pid: number }>
  >`SELECT pg_backend_pid() AS pid`;
  process.once('message', (command: QuotaProcessCommand) => {
    void (async () => {
      try {
        const reservation = await quota.begin({
          appcode: command.appcode,
          operationKey: command.operationKey,
          operationScope: 'integration',
        });
        if (!reservation) throw new Error('Expected reservation');
        if (command.tokens !== undefined) {
          try {
            await quota.reserveTokens(reservation, command.tokens);
          } catch (error) {
            await quota.settle(reservation, 0);
            throw error;
          }
        }
        const hold = async () => {
          process.send?.({ type: 'held', id: reservation.id });
          await new Promise<void>(() => undefined);
        };
        if (command.hold === 'after-reserve') await hold();
        if (command.hold === 'during-log' || command.hold === 'after-log') {
          await quota.recordUsage(
            reservation,
            async (tx) => {
              const log = await tx.bedrockSearchLog.create({
                data: {
                  appcode: command.appcode,
                  searchword: '[TEST]',
                  responsetime: 1,
                  totaltokens: 25,
                },
              });
              if (command.hold === 'during-log') await hold();
              return log;
            },
            'bedrock',
          );
          await hold();
        }
        process.send?.({ type: 'result', ok: true, id: reservation.id });
      } catch (error) {
        const status =
          typeof (error as { getStatus?: unknown })?.getStatus === 'function'
            ? (error as { getStatus(): number }).getStatus()
            : 500;
        process.send?.({ type: 'result', ok: false, status });
      } finally {
        await prisma.$disconnect();
        process.disconnect?.();
      }
    })().catch(() => process.exit(1));
  });
  process.send?.({ type: 'ready', pid: process.pid, backendPid: backend.pid });
}
void main().catch(() => process.exit(1));
