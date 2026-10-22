import { isAppError } from '@daisy/errors';

// The default shared pool has five writer/watchdog pairs; reserve headroom for discovery and public/control work.
const MAX_ACTIVE_ROUNDS = 2;

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
  /** `stage` names the work that failed: discover, tick, evaluate, finalize or rate. */
  readonly failed: (error: unknown, stage: string) => void;
};

async function maintainRound<Handle>(
  input: MaintenancePorts<Handle>,
  roundId: string,
) {
  let stage = 'tick';
  try {
    await input.tick(roundId);
    stage = 'evaluate';
    const resolution = await input.evaluate(roundId);
    if (
      resolution?.decision === 'forfeit' ||
      resolution?.decision === 'abandoned'
    )
      return;
    stage = 'finalize';
    await input.finalize(roundId);
  } catch (error) {
    if (
      isAppError(error) &&
      error.code === 'CONFLICT' &&
      error.message === 'attendance-terminal'
    )
      return;
    input.failed(error, stage);
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
  const waiting = new Set<string>();
  const advance = () => {
    while (!stopped && active.size < MAX_ACTIVE_ROUNDS && waiting.size > 0) {
      const id = waiting.values().next().value;
      if (id === undefined) return;
      waiting.delete(id);
      const work = Promise.resolve()
        .then(() => maintainRound(input, id))
        .finally(() => {
          active.delete(id);
          advance();
        });
      active.set(id, work);
    }
  };
  const remember = (ids: readonly string[]) => {
    const current = new Set(ids);
    for (const id of waiting) if (!current.has(id)) waiting.delete(id);
    for (const id of ids) if (!active.has(id)) waiting.add(id);
    advance();
  };
  const discover = async () => {
    if (stopped || discovering) return;
    discovering = true;
    try {
      const ids = await input.discover();
      if (!stopped) remember(ids);
    } catch (error) {
      input.failed(error, 'discover');
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
      input.failed(error, 'rate');
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
      waiting.clear();
      input.timers.clearInterval(timer);
      closing ??= Promise.all([discoveryWork, ratingWork]).then(async () => {
        await Promise.all(active.values());
      });
      return closing;
    },
  };
}
