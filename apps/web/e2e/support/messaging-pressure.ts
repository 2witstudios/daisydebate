type PressureSample = {
  readonly stage: 'setup' | 'target' | 'release';
  readonly entered: number;
  readonly result: 'ready' | 'failed';
  readonly faults: number;
};

/** Test-only pressure ownership: a failed entrant cannot abandon its peers. */
export function createMessagingPressure<Scope>(
  hold: (scope: Scope, work: () => Promise<void>) => Promise<void>,
  report: (sample: PressureSample, errors: readonly unknown[]) => void,
) {
  let settling: Promise<void> | null = null;
  return async <T>(scope: Scope, run: () => Promise<T>): Promise<T> => {
    while (settling !== null) await settling;
    const done = Promise.withResolvers<void>();
    settling = done.promise;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let readers = 0;
    const holders = Array.from({ length: 4 }, () =>
      Promise.resolve().then(() =>
        hold(scope, async () => {
          readers += 1;
          if (readers === 4) entered.resolve();
          await release.promise;
        }),
      ),
    );
    for (const holder of holders)
      void holder.catch((error: unknown) => {
        // A setup rejection must release already-entered peers immediately.
        release.resolve();
        entered.reject(error);
      });
    let outcome:
      | { readonly kind: 'ready'; readonly value: T }
      | { readonly kind: 'failed'; readonly error: unknown };
    let stage: PressureSample['stage'] = 'setup';
    let results: PromiseSettledResult<void>[];
    try {
      try {
        await entered.promise;
        report({ stage, entered: readers, result: 'ready', faults: 0 }, []);
        stage = 'target';
        outcome = { kind: 'ready', value: await run() };
        report({ stage, entered: readers, result: 'ready', faults: 0 }, []);
      } catch (error) {
        outcome = { kind: 'failed', error };
        report({ stage, entered: readers, result: 'failed', faults: 1 }, [
          error,
        ]);
      }
    } finally {
      release.resolve();
      try {
        results = await Promise.allSettled(holders);
      } finally {
        // Only full holder settlement transfers ownership to the next request.
        settling = null;
        done.resolve();
      }
    }
    const rejected = results.filter((result) => result.status === 'rejected');
    report(
      {
        stage: 'release',
        entered: readers,
        result: rejected.length === 0 ? 'ready' : 'failed',
        faults: rejected.length,
      },
      rejected.map((result) => result.reason),
    );
    if (rejected.length > 0 || (stage === 'setup' && outcome.kind === 'failed'))
      throw new AggregateError(
        [
          ...new Set([
            ...(outcome.kind === 'failed' ? [outcome.error] : []),
            ...rejected.map((result) => result.reason),
          ]),
        ],
        'Messaging admission proof failed',
      );
    if (outcome.kind === 'failed') throw outcome.error;
    return outcome.value;
  };
}
