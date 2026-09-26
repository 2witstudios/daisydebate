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
 *
 * Confirming the namespace alone still leaves a gap review caught: a
 * confirmed namespace says nothing about which Redis instance
 * `REDIS_URL` actually points at (this repo's shared-Redis-per-namespace
 * architecture, ADR 0034, makes that a real question, not a hypothetical
 * one) — an operator could correctly confirm the intended namespace while
 * a stale or wrong `REDIS_URL` in the environment points at a live
 * deployment's own Redis. `--confirm-redis-host` closes it the same way:
 * an explicit, separate retyping, this time of `REDIS_URL`'s host only
 * (`new URL(redisUrl).host`, never the full URL) — a Redis URL routinely
 * carries a password, and a confirmation argument is a command-line
 * argument, so the host is the only part of it this check ever compares
 * or echoes back in a refusal message.
 */
export function refusalForRedis(
  redisUrl: string,
  namespace: string,
  confirmedNamespace: string | undefined,
  confirmedHost: string | undefined,
): string | undefined {
  const host = new URL(redisUrl).host;
  if (confirmedNamespace === namespace && confirmedHost === host)
    return undefined;
  return (
    `Refusing: pass both --confirm-redis-namespace ${namespace} and ` +
    `--confirm-redis-host ${host}, exactly matching REDIS_NAMESPACE and ` +
    "REDIS_URL's host, only after independently confirming this Redis " +
    'target — namespace and instance both — belongs to the isolated ' +
    'restore target, never one a live deployment still reads from.'
  );
}
