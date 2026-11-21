import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

/** Releases the isolated challenge-table lock on either outcome. */
export async function withChallengeReadLocked<T>(run: () => Promise<T>) {
  const completed = promisify(execFile)(
    'bun',
    [resolve(import.meta.dirname, 'challenge-read-lock-process.ts')],
    { timeout: 15_000, maxBuffer: 4096 },
  );
  const { child } = completed;
  const settled = completed.catch(() => {
    throw new Error('Challenge read lock process failed');
  });
  try {
    const [ready] = await Promise.race([
      once(child.stdout!, 'data'),
      settled.then(() => {
        throw new Error(
          'Challenge read lock process exited before acquiring the lock',
        );
      }),
    ]);
    if (String(ready) !== 'locked\n')
      throw new Error(
        'Challenge read lock process did not acknowledge the lock',
      );
    return await run();
  } finally {
    child.stdin?.end();
    await settled;
  }
}
