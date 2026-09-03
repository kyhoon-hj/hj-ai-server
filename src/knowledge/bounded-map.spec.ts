import { mapWithConcurrency } from './bounded-map';

describe('mapWithConcurrency', () => {
  it('preserves result order while limiting active work', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([30, 10, 20, 5], 2, async (ms) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active -= 1;
      return ms * 2;
    });

    expect(result).toEqual([60, 20, 40, 10]);
    expect(peak).toBe(2);
  });

  it('stops scheduling new work after a mapper failure', async () => {
    const visited: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4], 1, async (value) => {
        await Promise.resolve();
        visited.push(value);
        if (value === 2) throw new Error('failed');
        return value;
      }),
    ).rejects.toThrow('failed');
    expect(visited).toEqual([1, 2]);
  });
});
