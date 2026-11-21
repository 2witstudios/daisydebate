const nextTurn = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

/**
 * `promise`, or a failure naming what never happened when it does not
 * settle within `turns` turns of the event loop, so a regression fails with
 * a reason, not a timeout. The work it waits on is in memory, so it needs
 * turns, never real time.
 */
export async function within<T>(
  promise: Promise<T>,
  what: string,
  turns = 1_000,
): Promise<T> {
  let settled = false;
  const watched = promise.finally(() => {
    settled = true;
  });
  // A rejection is the caller's to see, from the returned promise.
  watched.catch(() => undefined);
  for (let turn = 0; turn < turns && !settled; turn += 1) await nextTurn();
  if (!settled) throw new Error(`${what} never happened`);
  return watched;
}
