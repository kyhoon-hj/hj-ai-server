import { PrismaClient } from '@prisma/client';

// Measures this Node process (including SDK/fixtures), not PostgreSQL CPU/RSS.
export async function startLoadResourceSampler(db: PrismaClient) {
  const initial = process.memoryUsage();
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  let peakRssBytes = initial.rss;
  let peakHeapUsedBytes = initial.heapUsed;
  let peakWorkerConnections = 0;
  let peakActiveWorkerConnections = 0;
  let samples = 0;
  let sampleError: unknown;
  const sample = async () => {
    const memory = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
    const [connections] = await db.$queryRaw<
      Array<{ total: number; active: number }>
    >`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE state = 'active')::int AS active
      FROM pg_stat_activity WHERE datname = current_database()
        AND application_name = 'network-e2e-worker'
    `;
    peakWorkerConnections = Math.max(peakWorkerConnections, connections.total);
    peakActiveWorkerConnections = Math.max(
      peakActiveWorkerConnections,
      connections.active,
    );
    samples++;
  };
  await sample();
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (pending) return;
    pending = sample()
      .catch((error: unknown) => {
        sampleError = error;
      })
      .finally(() => {
        pending = undefined;
      });
  }, 100);
  return {
    async stop() {
      clearInterval(timer);
      await pending;
      await sample();
      if (sampleError)
        throw sampleError instanceof Error
          ? sampleError
          : new Error('Load resource sampling failed.');
      const cpu = process.cpuUsage(cpuStart);
      const elapsedMs = performance.now() - started;
      const final = process.memoryUsage();
      return {
        sampleIntervalMs: 100,
        samples,
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        cpuPercentOfOneCore: Number(
          ((cpu.user + cpu.system) / (elapsedMs * 10)).toFixed(2),
        ),
        rssStartBytes: initial.rss,
        rssEndBytes: final.rss,
        peakRssBytes,
        heapUsedStartBytes: initial.heapUsed,
        heapUsedEndBytes: final.heapUsed,
        peakHeapUsedBytes,
        peakWorkerConnections,
        peakActiveWorkerConnections,
      };
    },
  };
}
