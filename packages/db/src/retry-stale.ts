/**
 * Retries only work whose facts moved under a concurrent write, each time
 * from fresh facts; past the last attempt, `exhausted` names the refusal.
 */
export async function retryStale<T>(
  attempt: () => Promise<T>,
  isStale: (error: unknown) => boolean,
  attempts: number,
  exhausted: () => Error,
): Promise<T> {
  for (let tried = 1; ; tried += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isStale(error)) throw error;
      if (tried >= attempts) throw exhausted();
    }
  }
}
