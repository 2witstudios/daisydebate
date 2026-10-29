type SuiteDurations = Readonly<Record<string, number>>;

const invalidShard =
  'Integration shard must be INDEX/COUNT with 1 <= INDEX <= COUNT <= 64';

/** Longest suites first; timings affect placement, never coverage. */
export function partitionSuites(
  files: readonly string[],
  count: number,
  durations: SuiteDurations = {},
): string[][] {
  if (!Number.isInteger(count) || count < 1 || count > 64)
    throw new Error(invalidShard);
  const weight = (file: string) => {
    const measured = durations[file];
    return Number.isFinite(measured) && measured > 0 ? measured : 1000;
  };
  const shards = Array.from({ length: count }, () => ({
    files: [] as string[],
    duration: 0,
  }));
  const ordered = [...new Set(files)].sort(
    (a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const file of ordered) {
    const target = shards.reduce((least, shard) =>
      shard.duration < least.duration ? shard : least,
    );
    target.files.push(file);
    target.duration += weight(file);
  }
  return shards.map(({ files }) => files.sort());
}

export function selectShard(
  files: readonly string[],
  selector?: string,
  durations: SuiteDurations = {},
): readonly string[] {
  if (selector === undefined) return files;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(selector);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(index) || index > count)
    throw new Error(invalidShard);
  return partitionSuites(files, count, durations)[index - 1];
}
