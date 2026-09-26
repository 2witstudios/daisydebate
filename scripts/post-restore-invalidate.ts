/**
 * `bun scripts/post-restore-invalidate.ts`: AUTH-7.6's post-restore step,
 * the command the restore runbook (`docs/operations/restore-rehearsal.md`)
 * invokes before a restored database takes traffic. Deletes every session
 * and verification row (`Database.purgeAllForRestore`) and clears the auth
 * rate-limit counters of one Redis namespace (`clearAuthRateLimits`), so a
 * pre-restore session cookie or emailed link can never authenticate against
 * the restored copy, and prints only row counts — never a connection
 * string, a token or a secret.
 *
 * Refuses by default unless `DATABASE_URL`'s database name contains
 * "restore": this command is destructive to every session and verification
 * row in whatever database it points at, so it must never be pointed at a
 * database still serving traffic (a naming mistake is the one failure mode
 * a database name check can catch). `--force` overrides the name check for
 * an isolated database that does not happen to carry "restore" in its name;
 * it never overrides anything else.
 *
 * The Redis target is guarded separately and unconditionally: a real
 * restore's `REDIS_NAMESPACE` need not contain "restore" (a blue/green
 * restore can reuse the live namespace on purpose), so there is no name
 * pattern to infer isolation from. `--confirm-redis-namespace <namespace>`
 * must retype `REDIS_NAMESPACE`'s exact value, an explicit, deliberate act
 * an operator only takes after independently confirming that namespace
 * belongs to the isolated restore target — `--force` never substitutes for
 * it.
 */
import { RedisClient } from 'bun';
import { systemId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { clearAuthRateLimits } from '@daisy/redis/namespaces';
import { refusalFor, refusalForRedis } from './restore-guard';

const args = process.argv.slice(2);
const force = args.includes('--force');
const confirmFlagIndex = args.indexOf('--confirm-redis-namespace');
const confirmedRedisNamespace =
  confirmFlagIndex === -1 ? undefined : args[confirmFlagIndex + 1];

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const redisNamespace = process.env.REDIS_NAMESPACE;

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!redisUrl) throw new Error('REDIS_URL is required');
if (!redisNamespace) throw new Error('REDIS_NAMESPACE is required');

const refusal = refusalFor(databaseUrl, force);
if (refusal) throw new Error(refusal);

const redisRefusal = refusalForRedis(redisNamespace, confirmedRedisNamespace);
if (redisRefusal) throw new Error(redisRefusal);

const targetDatabaseName = new URL(databaseUrl).pathname.replace(/^\//, '');

const database = createDatabase({
  url: databaseUrl,
  nextActorId: systemId.next,
});
const redis = new RedisClient(redisUrl);

try {
  const purged = await database.purgeAllForRestore();
  const clearedRateLimitKeys = await clearAuthRateLimits(redis, redisNamespace);
  console.log(
    JSON.stringify({
      database: targetDatabaseName,
      redisNamespace,
      deletedSessions: purged.sessions,
      deletedVerifications: purged.verifications,
      clearedRateLimitKeys,
    }),
  );
} finally {
  await database.close();
  redis.close();
}
