type PressureSample = {
  readonly stage: 'setup' | 'target' | 'release';
  readonly entered: number;
  readonly result: 'ready' | 'failed';
  readonly faults: number;
};
type Epoch = {
  state: 'preparing' | 'held' | 'released';
  entered: number;
  readonly ready: ReturnType<typeof Promise.withResolvers<void>>;
  readonly release: ReturnType<typeof Promise.withResolvers<void>>;
  readonly faults: unknown[];
  readonly targetFailures: unknown[];
  holders: Promise<void>[];
  cancel: () => void;
  settlement: Promise<readonly unknown[]> | null;
};

/** Test-only, finite real-holder epoch acknowledged before page fanout begins. */
export function createMessagingPressure<Scope>(
  hold: (scope: Scope, work: () => Promise<void>) => Promise<void>,
  report: (sample: PressureSample, errors: readonly unknown[]) => void,
  scheduleExpiry: (expire: () => void) => () => void,
) {
  let current: Epoch | null = null;
  let retired: {
    readonly epoch: Epoch;
    readonly errors: readonly unknown[];
  } | null = null;
  let commands = Promise.resolve();
  const command = (run: () => Promise<void>) => {
    const result = commands.then(run);
    commands = result.catch(() => undefined);
    return result;
  };
  const release = (epoch: Epoch) => {
    if (epoch.settlement) return epoch.settlement;
    epoch.state = 'released';
    epoch.cancel();
    epoch.release.resolve();
    epoch.settlement = Promise.allSettled(epoch.holders).then((results) => {
      const failures = [
        ...new Set([
          ...epoch.faults,
          ...results.flatMap((result) =>
            result.status === 'rejected' ? [result.reason] : [],
          ),
        ]),
      ];
      const errors =
        failures.length === 0
          ? []
          : [...new Set([...epoch.targetFailures, ...failures])];
      if (errors.length) retired = { epoch, errors };
      if (current === epoch) current = null;
      report(
        {
          stage: 'release',
          entered: epoch.entered,
          result: failures.length === 0 ? 'ready' : 'failed',
          faults: failures.length,
        },
        failures,
      );
      return errors;
    });
    return epoch.settlement;
  };
  const consumeFailure = (epoch?: Epoch) => {
    if (!retired || (epoch !== undefined && retired.epoch !== epoch)) return [];
    const { errors } = retired;
    retired = null;
    return errors;
  };
  const allow = async () => {
    if (current) await release(current);
    const errors = consumeFailure();
    if (errors.length)
      throw new AggregateError(errors, 'Messaging pressure release failed');
  };
  return {
    allow: () => command(allow),
    prepare: (scope: Scope) =>
      command(async () => {
        await allow();
        const epoch: Epoch = {
          state: 'preparing',
          entered: 0,
          ready: Promise.withResolvers<void>(),
          release: Promise.withResolvers<void>(),
          faults: [],
          targetFailures: [],
          holders: [],
          cancel: () => {},
          settlement: null,
        };
        current = epoch;
        epoch.holders = Array.from({ length: 4 }, () =>
          Promise.resolve().then(() =>
            hold(scope, async () => {
              if (current !== epoch || epoch.state === 'released')
                throw new Error('Late Messaging pressure entrant');
              epoch.entered += 1;
              if (epoch.entered === 4) epoch.ready.resolve();
              await epoch.release.promise;
            }),
          ),
        );
        for (const holder of epoch.holders)
          void holder.catch((error: unknown) => {
            epoch.faults.push(error);
            epoch.ready.reject(error);
            void release(epoch);
          });
        epoch.cancel = scheduleExpiry(() => {
          if (current !== epoch || epoch.state === 'released') return;
          const error = new Error('Messaging pressure epoch expired');
          epoch.faults.push(error);
          epoch.ready.reject(error);
          void release(epoch);
        });
        try {
          await epoch.ready.promise;
          if (
            current !== epoch ||
            epoch.state === 'released' ||
            epoch.faults.length
          )
            throw new Error('Messaging pressure preparation failed');
          epoch.state = 'held';
          report(
            {
              stage: 'setup',
              entered: epoch.entered,
              result: 'ready',
              faults: 0,
            },
            [],
          );
        } catch (error) {
          epoch.faults.push(error);
          report(
            {
              stage: 'setup',
              entered: epoch.entered,
              result: 'failed',
              faults: 1,
            },
            [error],
          );
          await release(epoch);
          throw new AggregateError(
            consumeFailure(epoch),
            'Messaging pressure preparation failed',
          );
        }
      }),
    target: async <T>(run: () => Promise<T>): Promise<T> => {
      const epoch = current;
      if (!epoch || epoch.state !== 'held' || epoch.faults.length)
        throw new Error('Messaging pressure is not ready');
      try {
        const value = await run();
        if (current !== epoch || epoch.state !== 'held')
          throw new Error('Messaging pressure target outlived its epoch');
        report(
          {
            stage: 'target',
            entered: epoch.entered,
            result: 'ready',
            faults: 0,
          },
          [],
        );
        return value;
      } catch (error) {
        epoch.targetFailures.push(error);
        report(
          {
            stage: 'target',
            entered: epoch.entered,
            result: 'failed',
            faults: 1,
          },
          [error],
        );
        if (epoch.faults.length)
          throw new AggregateError(
            [error, ...epoch.faults],
            'Messaging pressure target and holder failed',
          );
        throw error;
      }
    },
  };
}
