/**
 * Setup attempts when a holder loses only to real page traffic: the social
 * lane waits 100 ms (packages/db workload-admission), so one page read still
 * in flight when the four holders queue can expire the fourth. Nothing was
 * held or targeted, and each attempt is released and reported before the next.
 */
const PRESSURE_SETUP_ATTEMPTS = 3;

/** The entire private control transition owns parsing, release, ACK and publication. */
export function createMessagingPressureControl<Scope>(
  pressure: {
    readonly prepare: (scope: Scope) => Promise<void>;
    readonly allow: () => Promise<void>;
  },
  /** True for a setup that failed only to lane contention. */
  contended: (error: unknown) => boolean = () => false,
) {
  let mode: 'history' | 'entry' | null = null;
  let commands = Promise.resolve();
  const command = (run: () => Promise<void>) => {
    const result = commands.then(run);
    commands = result.catch(() => undefined);
    return result;
  };
  const prepareScope = async (scope: Scope) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await pressure.prepare(scope);
      } catch (error) {
        if (attempt >= PRESSURE_SETUP_ATTEMPTS || !contended(error))
          throw error;
      }
    }
  };
  return {
    mode: () => mode,
    prepare: (next: 'history' | 'entry', selectors: () => Promise<Scope>) =>
      command(async () => {
        mode = null;
        await pressure.allow();
        const scope = await selectors();
        await prepareScope(scope);
        mode = next;
      }),
    allow: () =>
      command(async () => {
        mode = null;
        await pressure.allow();
      }),
  };
}
