import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
/** Bun owns application work; Node remains only the browser driver. No fixture clock rewrite. */
export async function maintainHumanBallotFixtures(
  roundIds: readonly string[],
  freeze = false,
) {
  const { stdout } = await promisify(execFile)(
    'bun',
    [
      resolve(import.meta.dirname, 'human-ballot-maintenance-process.ts'),
      freeze ? 'freeze' : 'tick',
      ...roundIds,
    ],
    {
      cwd: resolve(import.meta.dirname, '../../../..'),
      env: process.env,
      timeout: 160_000,
      maxBuffer: 4096,
    },
  ).catch(() => {
    throw new Error('Actual ballot maintenance fixture refused');
  });
  const result = JSON.parse(stdout);
  if (JSON.stringify(result.roundIds) !== JSON.stringify(roundIds))
    throw new Error('Actual frozen fixture scope mismatch');
}
