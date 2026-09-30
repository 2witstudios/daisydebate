import { z } from 'zod';
import {
  expectedTestRedisDatabase,
  testRedisRefusal,
  type OwnTestRedisUrl,
} from './test-redis';
import { databaseUrl, redisUrl } from './urls';

/**
 * The suffix of a run's own database (ISSUE-238): the slot's `_test`
 * database name, `_run_`, and eight hex digits from the runner's CSPRNG.
 */
const TEST_RUN_DATABASE_SUFFIX = /_test_run_[0-9a-f]{8}$/;

type TestServices = {
  readonly databaseUrl: string;
  readonly redisUrl: OwnTestRedisUrl;
};

/**
 * Both readers share the Redis rule (ISSUE-245): TEST_REDIS_URL must be this
 * slot's own database on the server REDIS_URL names, so a suite or the runner
 * started against another slot's, dev's or e2e's Redis is refused before it
 * writes or deletes a key. Only the database rule differs.
 */
const testServicesSchema = (databaseRule: z.ZodType<string>) =>
  z
    .object({
      TEST_DATABASE_URL: databaseRule,
      TEST_REDIS_URL: redisUrl,
      REDIS_URL: z.string().optional(),
      PORT: z.string().optional(),
    })
    .superRefine((env, ctx) => {
      const message = testRedisRefusal({
        testRedisUrl: env.TEST_REDIS_URL,
        redisUrl: env.REDIS_URL,
        expected: expectedTestRedisDatabase(env.PORT),
      });
      if (message)
        ctx.addIssue({ code: 'custom', path: ['TEST_REDIS_URL'], message });
    });
const readTestServices = (
  schema: ReturnType<typeof testServicesSchema>,
  env: Record<string, string | undefined>,
): TestServices => {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Integration suites require isolated test services: ${result.error.issues
        .map((issue) =>
          issue.code === 'custom'
            ? `${issue.path.join('.')} (${issue.message})`
            : issue.path.join('.'),
        )
        .join(', ')}`,
    );
  return {
    databaseUrl: result.data.TEST_DATABASE_URL,
    redisUrl: result.data.TEST_REDIS_URL as OwnTestRedisUrl,
  };
};
const runDatabaseSchema = testServicesSchema(
  databaseUrl.refine(
    (value) => TEST_RUN_DATABASE_SUFFIX.test(new URL(value).pathname),
    "must name this run's database, ending in _test_run_ and 8 hex digits: run suites with bun test:integration, which creates and drops it",
  ),
);
const slotDatabaseSchema = testServicesSchema(
  databaseUrl.refine(
    (value) => new URL(value).pathname.endsWith('_test'),
    'must name a database ending in _test',
  ),
);
/**
 * The one guard every integration suite calls (ISSUE-11; `bun evidence`
 * checks each suite imports it). A missing or non-test service throws,
 * naming the fields and never their values: a suite never skips. The
 * database must be the one the runner made for this run, so a suite started
 * by hand against the slot database is refused rather than left to leak rows
 * (ISSUE-238), and the Redis URL must be this slot's own database on its own
 * server (ISSUE-245).
 */
export function requireTestServices(
  env: Record<string, string | undefined>,
): TestServices {
  return readTestServices(runDatabaseSchema, env);
}
/** The runner's view (ISSUE-238): the slot's `_test` database its per-run databases derive from, with the same Redis rule. */
export function requireTestSlotServices(
  env: Record<string, string | undefined>,
): TestServices {
  return readTestServices(slotDatabaseSchema, env);
}
