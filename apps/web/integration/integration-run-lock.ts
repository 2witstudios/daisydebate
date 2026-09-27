import { SQL } from 'bun';

/**
 * ISSUE-148: auth-restore-invalidation.integration.ts's purgeAllForRestore
 * call deletes every session and verification row database-wide — the
 * correct, unscoped contract for a real restore-copy invalidation, but
 * fatal to any other suite's rows if it runs at the same time on the same
 * test database. A session-scoped advisory lock, held for the caller's
 * whole process lifetime and released automatically when it exits, refuses
 * a second concurrent apps/web integration run against the same database
 * with a named error instead of letting the two silently corrupt each
 * other (the reviewer contract runs a reviewer in the builder's own
 * worktree, so this is a normal event, not a rare one). Proven against a
 * real two-way and three-way concurrent `bun test:integration` run: the
 * loser fails every file immediately with this error; the winner passes
 * unaffected.
 */
const INTEGRATION_RUN_LOCK_KEY = 148_001;

export async function acquireIntegrationRunLock(
  databaseUrl: string,
  lockKey: number = INTEGRATION_RUN_LOCK_KEY,
): Promise<void> {
  const connection = new SQL(databaseUrl, { max: 1 });
  const [{ acquired }] = (await connection`
    select pg_try_advisory_lock(${lockKey}) as acquired
  `) as [{ acquired: boolean }];
  if (!acquired)
    throw new Error(
      'ISSUE-148: another apps/web integration run already holds this test ' +
        'database. auth-restore-invalidation.integration.ts purges every ' +
        'session and verification row database-wide, which corrupts any ' +
        'other suite running at the same time on the same slot. Run ' +
        'bun test:integration serially — never two at once against one ' +
        "slot's test database.",
    );
}
