import { resolve } from 'node:path';

/** Shared process options keep both native runners under the canonical limiter. */
export const browserDriverOptions = (
  checkout: string,
  env: Readonly<Record<string, string | undefined>>,
) => ({
  cwd: resolve(checkout, 'apps/web'),
  env,
  stdout: 'inherit' as const,
  stderr: 'inherit' as const,
});
export async function finishBrowserDriver(
  child: Pick<ReturnType<typeof Bun.spawn>, 'kill' | 'exited'>,
) {
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => child.kill(signal));
  process.exitCode = await child.exited;
}
