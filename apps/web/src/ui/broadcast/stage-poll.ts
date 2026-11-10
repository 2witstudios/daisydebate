/**
 * Reads the stage now and on every tick, one read at a time: a tick while a read is in
 * flight is skipped, so answers cannot land out of order or pile up behind a dead web
 * tier. A read that rejects is over; the next tick reads again. Returns the stop.
 */
export function startStagePoll(resources: {
  readonly read: () => Promise<void>;
  readonly every: (tick: () => void) => () => void;
}) {
  let reading = false;
  const tick = () => {
    if (reading) return;
    reading = true;
    void resources
      .read()
      .catch(() => undefined)
      .finally(() => {
        reading = false;
      });
  };
  tick();
  return resources.every(tick);
}
