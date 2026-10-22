import { isAppError } from '@daisy/errors';

type MaintenancePorts<Handle> = {
  readonly discover: () => Promise<readonly string[]>;
  readonly tick: (roundId: string) => Promise<unknown>;
  readonly evaluate: (
    roundId: string,
  ) => Promise<{ readonly decision: string } | null>;
  readonly finalize: (roundId: string) => Promise<unknown>;
  readonly rateUnrated: () => Promise<unknown>;
  readonly timers: {
    readonly setInterval: (pulse: () => void, ms: number) => Handle;
    readonly clearInterval: (handle: Handle) => void;
  };
  readonly failed: (error: unknown) => void;
};

async function maintainRound<Handle>(
  input: MaintenancePorts<Handle>,
  roundId: string,
) {
  try {
    await input.tick(roundId);
    const resolution = await input.evaluate(roundId);
    if (
      resolution?.decision === 'forfeit' ||
      resolution?.decision === 'abandoned'
    )
      return;
    await input.finalize(roundId);
  } catch (error) {
    if (
      isAppError(error) &&
      error.code === 'CONFLICT' &&
      error.message === 'attendance-terminal'
    )
      return;
    input.failed(error);
  }
}

/** Discovery and committed-rating recovery never wait for a competing Round's work. */
export function startRoundMaintenance<Handle>(input: MaintenancePorts<Handle>) {
  let stopped = false,
    discovering = false,
    rating = false;
  let discoveryWork = Promise.resolve(),
    ratingWork = Promise.resolve();
  const active = new Map<string, Promise<void>>();
  const discover = async () => {
    if (stopped || discovering) return;
    discovering = true;
    try {
      const ids = await input.discover();
      for (const id of ids) {
        if (stopped || active.has(id)) continue;
        const work = Promise.resolve()
          .then(() => maintainRound(input, id))
          .finally(() => {
            active.delete(id);
          });
        active.set(id, work);
      }
    } catch (error) {
      input.failed(error);
    } finally {
      discovering = false;
    }
  };
  const recoverRatings = async () => {
    if (stopped || rating) return;
    rating = true;
    try {
      await input.rateUnrated();
    } catch (error) {
      input.failed(error);
    } finally {
      rating = false;
    }
  };
  const pulse = () => {
    if (!discovering) discoveryWork = discover();
    if (!rating) ratingWork = recoverRatings();
    return Promise.all([discoveryWork, ratingWork]).then(() => undefined);
  };
  const timer = input.timers.setInterval(() => {
    void pulse();
  }, 500);
  const ready = pulse();
  let closing: Promise<void> | undefined;
  return {
    ready,
    stop: () => {
      stopped = true;
      input.timers.clearInterval(timer);
      closing ??= Promise.all([discoveryWork, ratingWork]).then(async () => {
        await Promise.all(active.values());
      });
      return closing;
    },
  };
}
