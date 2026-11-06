/** The entire private control transition owns parsing, release, ACK and publication. */
export function createMessagingPressureControl<Scope>(pressure: {
  readonly prepare: (scope: Scope) => Promise<void>;
  readonly allow: () => Promise<void>;
}) {
  let mode: 'history' | 'entry' | null = null;
  let commands = Promise.resolve();
  const command = (run: () => Promise<void>) => {
    const result = commands.then(run);
    commands = result.catch(() => undefined);
    return result;
  };
  return {
    mode: () => mode,
    prepare: (next: 'history' | 'entry', selectors: () => Promise<Scope>) =>
      command(async () => {
        mode = null;
        await pressure.allow();
        const scope = await selectors();
        await pressure.prepare(scope);
        mode = next;
      }),
    allow: () =>
      command(async () => {
        mode = null;
        await pressure.allow();
      }),
  };
}
