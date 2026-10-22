/** Handles only processes this fixture actually spawns; no PID discovery or foreign service mutation. */
export function createLaunchProcess(input: {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly ready: () => Promise<boolean>;
}) {
  let child: ReturnType<typeof Bun.spawn> | null = null;
  let chain = Promise.resolve();
  const serialize = (operation: () => Promise<void>) => {
    const next = chain.then(operation);
    chain = next.catch(() => undefined);
    return next;
  };
  const stop = async () => {
    if (!child) return;
    const owned = child;
    child = null;
    owned.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        owned.exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            owned.kill('SIGKILL');
            reject(new Error('Owned proof process did not drain'));
          }, 30000);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  };
  const start = async () => {
    if (child && child.exitCode === null) return;
    child = Bun.spawn([...input.command], {
      cwd: input.cwd,
      env: input.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const deadline = performance.now() + 60000;
    for (;;) {
      if (child.exitCode !== null)
        throw new Error('Owned proof process exited before readiness');
      if (await input.ready()) return;
      if (performance.now() >= deadline) {
        await stop();
        throw new Error('Owned proof process readiness deadline');
      }
      await Bun.sleep(50);
    }
  };
  return {
    start: () => serialize(start),
    stop: () => serialize(stop),
    restart: () =>
      serialize(async () => {
        await stop();
        await start();
      }),
  };
}
