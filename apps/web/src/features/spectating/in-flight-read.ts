/**
 * A read that stays fresh under a crowd: whoever asks while one is running joins
 * it, and nothing is held once it settles. An answer is never older than the read
 * running when it was asked for, so an unlisted Round's replaced link stops
 * admitting as soon as a read that saw the replacement has run (ADR 0109).
 */
export const joinReadInFlight = <T>() => {
  const running = new Map<string, Promise<T>>();
  return (key: string, read: () => Promise<T>): Promise<T> => {
    const joined = running.get(key);
    if (joined) return joined;
    const started = read().finally(() => running.delete(key));
    running.set(key, started);
    return started;
  };
};
