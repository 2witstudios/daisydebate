/**
 * Reads the stage now and on every tick, so the stage watch samples once a second even
 * while a dead web tier makes each read wait out its timeout. Reads may overlap; each is
 * handed `isFresh`, true only when no later read has already been applied, and it marks
 * this read applied. A late, older answer is stale and changes nothing. A read that
 * rejects is over; the next tick reads again. Returns the stop.
 */
export function startStagePoll(resources: {
  readonly read: (isFresh: () => boolean) => Promise<void>;
  readonly every: (tick: () => void) => () => void;
}) {
  let started = 0;
  let applied = 0;
  const tick = () => {
    started += 1;
    const order = started;
    const isFresh = () => {
      if (order <= applied) return false;
      applied = order;
      return true;
    };
    void resources.read(isFresh).catch(() => undefined);
  };
  tick();
  return resources.every(tick);
}
