/**
 * The time seams a dropped sign-up uses to occupy the handed-off work's
 * capacity exactly as a real send does (ISSUE-185, DEC-41): a monotonic
 * clock to measure provider round trips, a delay to wait one out, and a
 * uniform index to pick one. The composition root supplies the host's;
 * tests supply deterministic ones.
 */
export type SendPacing = {
  /** Monotonic milliseconds; only differences are meaningful. */
  readonly elapsedMs: () => number;
  readonly delay: (ms: number) => Promise<void>;
  /** A uniform index in [0, size). */
  readonly pick: (size: number) => number;
};

/** Durations kept: the most recent, so the sample follows the provider. */
const PROVIDER_LATENCY_SAMPLES = 64;

/** The stand-in's own timer wake-ups and writes kept for their means. */
const OWN_COST_SAMPLES = 16;

/**
 * Used until the first real send is measured (a fresh process): a typical
 * Resend send, so a drop still holds its slot like a send would.
 */
export const PROVIDER_LATENCY_PRIOR_MS = 300;

/** A ring of the last `size` non-negative values: one drawn, or their mean. */
const createRing = (size: number) => {
  const values: number[] = [];
  let next = 0;
  return {
    observe: (ms: number) => {
      values[next] = Math.max(0, ms);
      next = (next + 1) % size;
    },
    at: (index: number) => values[index],
    size: () => values.length,
    mean: () =>
      values.length === 0
        ? 0
        : values.reduce((sum, ms) => sum + ms, 0) / values.length,
  };
};

/**
 * The recent sends' durations (every auth mail that reached the provider,
 * delivered or failed, from its suppression read to its end, receipt write
 * included), in a ring of PROVIDER_LATENCY_SAMPLES. `sample` draws one
 * uniformly with the injected index, so a dropped sign-up can end its work
 * on the same schedule as a send. The stand-in's own costs are tracked too
 * (the last OWN_COST_SAMPLES): how late its timer wakes up (`lateness`) and
 * how long its one write takes (`writeCost`), so it starts that write early
 * enough to finish when the sampled send would have.
 */
export function createProviderLatency(pick: SendPacing['pick']) {
  const durations = createRing(PROVIDER_LATENCY_SAMPLES);
  const late = createRing(OWN_COST_SAMPLES);
  const writes = createRing(OWN_COST_SAMPLES);
  return {
    observe: durations.observe,
    sample: (): number =>
      durations.size() === 0
        ? PROVIDER_LATENCY_PRIOR_MS
        : (durations.at(pick(durations.size())) ?? PROVIDER_LATENCY_PRIOR_MS),
    observeLateness: late.observe,
    lateness: late.mean,
    observeWriteCost: writes.observe,
    writeCost: writes.mean,
  };
}

export type ProviderLatency = ReturnType<typeof createProviderLatency>;

/**
 * The host's seams: `performance.now`, a timer, and an index from the OS
 * CSPRNG (rejection sampling, so every index is equally likely). Only the
 * composition root (`server/app.ts`) uses it.
 */
export const systemSendPacing: SendPacing = {
  elapsedMs: () => performance.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pick: (size) => {
    const limit = Math.floor(2 ** 32 / size) * size;
    const word = new Uint32Array(1);
    do crypto.getRandomValues(word);
    while ((word[0] ?? 0) >= limit);
    return (word[0] ?? 0) % size;
  },
};
