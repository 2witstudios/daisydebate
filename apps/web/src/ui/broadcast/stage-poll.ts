/**
 * Reads the stage now and on every tick, so the stage watch samples once a second even
 * while a dead web tier makes each read wait out its timeout. Reads may overlap, so the
 * poll applies whole answers itself, in the order the reads started: an answer older than
 * one already applied is dropped, and nothing is applied after the stop. A read that
 * rejects is over; the next tick reads again. Returns the stop.
 */
export function startStagePoll<A>(resources: {
  readonly read: () => Promise<A>;
  readonly apply: (answer: A) => void;
  readonly every: (tick: () => void) => () => void;
}) {
  let started = 0;
  let applied = 0;
  let stopped = false;
  const tick = () => {
    started += 1;
    const order = started;
    void resources
      .read()
      .then((answer) => {
        if (stopped || order <= applied) return;
        applied = order;
        resources.apply(answer);
      })
      .catch(() => undefined);
  };
  tick();
  const clear = resources.every(tick);
  return () => {
    stopped = true;
    clear();
  };
}
