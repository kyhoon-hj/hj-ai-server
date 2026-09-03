export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let stopped = false;

  async function worker() {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }

  const workerCount = Math.min(items.length, Math.max(1, concurrency));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
