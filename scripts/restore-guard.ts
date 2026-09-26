/**
 * The one check `scripts/post-restore-invalidate.ts` runs before opening any
 * connection: a database name that does not name itself a restore copy
 * refuses the command outright, `--force` aside. Pure so it is unit-tested
 * without a database.
 */
export function refusalFor(
  databaseUrl: string,
  force: boolean,
): string | undefined {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (force || name.toLowerCase().includes('restore')) return undefined;
  return (
    `Refusing: DATABASE_URL's database "${name}" does not name itself a ` +
    'restore copy (expected "restore" in the name). Pass --force only for ' +
    'a database you have independently confirmed is an isolated restore ' +
    'copy, never one taking live traffic.'
  );
}

/**
 * The one check `scripts/staging-restore-seed.ts` runs before opening any
 * connection: a database name that does not name itself staging refuses the
 * command outright, `--force` aside. This script writes synthetic users,
 * actors, a debate, sessions, passkeys and a verification token — real
 * writes, so a `DATABASE_URL` pointed at production by mistake must never
 * reach `applyDevSeed`'s first insert (AUTH-7.6 review).
 */
export function refusalForStagingSeed(
  databaseUrl: string,
  force: boolean,
): string | undefined {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (force || name.toLowerCase().includes('staging')) return undefined;
  return (
    `Refusing: DATABASE_URL's database "${name}" does not name itself ` +
    'staging (expected "staging" in the name). This script writes ' +
    'synthetic auth and debate rows and must never run against production. ' +
    'Pass --force only for a database you have independently confirmed is ' +
    'the intended staging database.'
  );
}

/**
 * `clearAuthRateLimits` acts on whatever `REDIS_NAMESPACE` names, entirely
 * independent of the database-name check above: a real restore's namespace
 * need not contain "restore" at all (a blue/green restore can reuse the
 * live app's own namespace on purpose), so this deliberately does not reuse
 * `refusalFor`'s name-pattern heuristic (AUTH-7.6 review). Instead it
 * requires the operator to retype the exact namespace as an explicit,
 * separate confirmation — a deliberate act, not an inferred one — so a
 * `REDIS_NAMESPACE` left over from a different, live command never gets
 * its rate-limit counters cleared by accident.
 */
export function refusalForRedis(
  namespace: string,
  confirmedNamespace: string | undefined,
): string | undefined {
  if (confirmedNamespace === namespace) return undefined;
  return (
    `Refusing: --confirm-redis-namespace was not passed with exactly ` +
    `REDIS_NAMESPACE's value ("${namespace}"). Pass ` +
    `--confirm-redis-namespace ${namespace} only after independently ` +
    'confirming this Redis namespace belongs to the isolated restore ' +
    'target, never a namespace a live deployment still reads from.'
  );
}
