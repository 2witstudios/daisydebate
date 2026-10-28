/**
 * `promise`, or a failure naming what never happened when it does not
 * settle within `ms`, so a regression fails with a reason, not a timeout.
 */
export function within<T>(promise: Promise<T>, what: string, ms = 1_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} never happened`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
