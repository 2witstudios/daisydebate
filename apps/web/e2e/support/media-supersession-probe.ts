/** A browser request's actual lifetime, recorded on the test runner's clock. */
type MediaProbeRead = { startedAt: number; endedAt: number | null };

/** The controlled read window starts only after setup has finished. */
export function createMediaSupersessionProbe<Request extends object>(input: {
  readonly now: () => number;
  readonly minBaselineAgeMs: number;
}) {
  const observed = new Map<Request, MediaProbeRead>();
  let armed: { read: MediaProbeRead; at: number } | null = null;
  return {
    start(request: Request) {
      observed.set(request, { startedAt: input.now(), endedAt: null });
    },
    finish(request: Request) {
      const read = observed.get(request);
      if (read && read.endedAt === null) read.endedAt = input.now();
    },
    arm() {
      if (armed) return true;
      const read = [...observed.values()].at(-1);
      const at = input.now();
      if (
        !read ||
        read.endedAt !== null ||
        at - read.startedAt < input.minBaselineAgeMs
      )
        return false;
      armed = { read, at };
      return true;
    },
    get armedAt() {
      return armed?.at ?? null;
    },
    get observed() {
      return [...observed.values()];
    },
    get window() {
      const reads = [...observed.values()];
      return armed ? reads.slice(reads.indexOf(armed.read)) : [];
    },
  };
}
