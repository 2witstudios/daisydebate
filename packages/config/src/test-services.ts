import { z } from 'zod';
import {
  expectedTestRedisDatabase,
  testRedisRefusal,
  type OwnTestRedisUrl,
} from './test-redis';
import { databaseUrl, redisUrl } from './urls';

const testServicesSchema = z
  .object({
    TEST_DATABASE_URL: databaseUrl.refine(
      (value) => new URL(value).pathname.endsWith('_test'),
      'must name a database ending in _test',
    ),
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
/**
 * The one guard every integration suite calls (ISSUE-11; `bun evidence`
 * checks each suite imports it). A missing or non-test service throws,
 * naming the fields and never their values: a suite never skips. The Redis
 * URL must be this slot's own database on its own server (ISSUE-245), so a
 * suite run directly against another slot's, dev's or e2e's Redis is refused
 * at import instead of deleting its keys.
 */
export function requireTestServices(env: Record<string, string | undefined>): {
  readonly databaseUrl: string;
  readonly redisUrl: OwnTestRedisUrl;
} {
  const result = testServicesSchema.safeParse(env);
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
}
