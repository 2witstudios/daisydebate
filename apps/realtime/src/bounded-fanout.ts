/**
 * Runs `work` over `items` with at most `limit` in flight, in item order
 * per lane. A failing item never stops the others or settles early.
 */
export async function boundedFanout<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]!).catch(() => {});
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, lane),
  );
}
