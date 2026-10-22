type Target = { readonly roundId: string; readonly judgeParticipantId: string };
type Claim = { readonly scope: Target; readonly token: string };
type Entry<C> = {
  readonly claim: C;
  readonly abort: AbortController;
  running: boolean;
  work: Promise<void>;
};
/** Lease renewal never queues behind provider execution or attendance settlement. */
export function startRoundJudgingService<C extends Claim>(input: {
  readonly store: {
    readonly scanRoundJudgingJobs: (
      limit: number,
    ) => Promise<readonly Target[]>;
    readonly claimRoundJudgingJob: (target: Target) => Promise<C>;
    readonly renewRoundJudgingJob: (
      scope: C['scope'],
      token: string,
    ) => Promise<unknown>;
    readonly verifyRoundJudgingJob: (
      scope: C['scope'],
      token: string,
    ) => Promise<{ readonly pendingBallot: unknown | null }>;
  };
  readonly execute: (claim: C, signal: AbortSignal) => Promise<unknown>;
  readonly limits: {
    readonly parallel: number;
    readonly scanBatch: number;
    readonly scanMs: number;
    readonly renewMs: number;
  };
  readonly timers: {
    readonly setInterval: (task: () => Promise<void>, ms: number) => unknown;
    readonly clearInterval: (handle: unknown) => void;
  };
  readonly failed: () => void;
}) {
  const entries = new Map<string, Entry<C>>();
  let stopped = false,
    scanning: Promise<void> | null = null,
    renewing: Promise<void> | null = null;
  const key = (target: Target) =>
    `${target.roundId}:${target.judgeParticipantId}`;
  const release = (entry: Entry<C>) => {
    entry.abort.abort();
    if (!entry.running) entries.delete(key(entry.claim.scope));
  };
  const execute = (entry: Entry<C>) => {
    if (entry.running || entry.abort.signal.aborted) return;
    entry.running = true;
    entry.work = (async () => {
      try {
        await input.execute(entry.claim, entry.abort.signal);
        release(entry);
      } catch {
        if (entry.abort.signal.aborted) return;
        try {
          const state = await input.store.verifyRoundJudgingJob(
            entry.claim.scope,
            entry.claim.token,
          );
          if (state.pendingBallot) return;
        } catch {
          /* A lost authority never becomes a retry permission. */
        }
        release(entry);
        input.failed();
      } finally {
        entry.running = false;
        if (entry.abort.signal.aborted) entries.delete(key(entry.claim.scope));
      }
    })();
  };
  const scan = (): Promise<void> => {
    if (stopped || scanning) return scanning ?? Promise.resolve();
    scanning = (async () => {
      try {
        for (const entry of entries.values()) execute(entry);
        const targets = await input.store.scanRoundJudgingJobs(
          input.limits.scanBatch,
        );
        for (const target of targets) {
          if (stopped || entries.size >= input.limits.parallel) break;
          if (entries.has(key(target))) continue;
          try {
            const claim = await input.store.claimRoundJudgingJob(target);
            if (stopped) break;
            const entry: Entry<C> = {
              claim,
              abort: new AbortController(),
              running: false,
              work: Promise.resolve(),
            };
            entries.set(key(target), entry);
            execute(entry);
          } catch {
            /* Discovery is advisory; another process may win the claim. */
          }
        }
      } catch {
        input.failed();
      } finally {
        scanning = null;
      }
    })();
    return scanning;
  };
  const renew = (): Promise<void> => {
    if (stopped || renewing) return renewing ?? Promise.resolve();
    renewing = Promise.all(
      [...entries.values()].map(async (entry) => {
        if (entry.abort.signal.aborted) return;
        try {
          await input.store.renewRoundJudgingJob(
            entry.claim.scope,
            entry.claim.token,
          );
        } catch {
          release(entry);
          input.failed();
        }
      }),
    ).then(() => {
      renewing = null;
    });
    return renewing;
  };
  const discovery = input.timers.setInterval(scan, input.limits.scanMs);
  const heartbeat = input.timers.setInterval(renew, input.limits.renewMs);
  const started = scan();
  return {
    started,
    async stop() {
      stopped = true;
      input.timers.clearInterval(discovery);
      input.timers.clearInterval(heartbeat);
      for (const entry of entries.values()) release(entry);
      await Promise.allSettled([
        scanning,
        renewing,
        ...[...entries.values()].map((entry) => entry.work),
      ]);
    },
  };
}
