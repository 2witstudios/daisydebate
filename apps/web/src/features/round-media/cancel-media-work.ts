/** Settle the client wait even when an API, retry pause or SDK ignores abort. */
export function cancelMediaWork<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', cancel);
    const cancel = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      // Both handlers remain attached after cancellation to observe late rejection.
      work().then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
