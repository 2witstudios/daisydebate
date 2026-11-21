export const DAY_MS = 86_400_000;

/**
 * One store the sweep prunes: `purge` deletes at most `limit` rows that are
 * due at `now` (the run's clock reading) and returns how many went. The
 * sweep calls it up to `maxBatches` times per run; a larger backlog drains
 * over later runs.
 */
export type RetentionTarget = {
  readonly name: string;
  readonly batchSize: number;
  readonly maxBatches: number;
  readonly purge: (input: {
    readonly now: string;
    readonly limit: number;
  }) => Promise<number>;
};

/** The UTC ISO cutoff `windowMs` before `now`; an unusable clock throws. */
const cutoff = (now: string, windowMs: number) => {
  const at = Date.parse(now);
  if (Number.isNaN(at)) throw new Error('Unusable clock value');
  return new Date(at - windowMs).toISOString();
};

type CutoffBatch = { readonly before: string; readonly limit: number };

/** The usual database target counts back from the sweep clock. */
export const retentionAfter = (
  name: string,
  windowMs: number,
  purge: (batch: CutoffBatch) => Promise<number>,
  {
    batchSize = 500,
    maxBatches = 20,
  }: {
    readonly batchSize?: number;
    readonly maxBatches?: number;
  } = {},
): RetentionTarget => ({
  name: `retention.${name}`,
  batchSize,
  maxBatches,
  purge: ({ now, limit }) => purge({ before: cutoff(now, windowMs), limit }),
});
