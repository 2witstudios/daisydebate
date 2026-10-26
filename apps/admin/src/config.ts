import { z } from 'zod';

/**
 * The admin app's environment, validated once at the process edge. Errors
 * name fields, never values. It holds no participant credential: no
 * DATABASE_URL, REDIS_URL or Better Auth secret (ADR 0076).
 */
const postgresUrl = z
  .string()
  .regex(/^postgres(?:ql)?:\/\/[^\s]+$/, 'must be a postgres:// URL');

const adminConfigSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  ADMIN_DATABASE_URL: postgresUrl,
  // Keys the stored client digest of the rate limiter (never a raw IP).
  ADMIN_ATTEMPT_KEY: z.string().min(32),
  ADMIN_PORT: z.coerce.number().int().min(1).max(65_535).default(4800),
  ADMIN_HOST: z.string().min(1).default('localhost'),
  APP_VERSION: z.string().min(1).default('development'),
  GIT_COMMIT: z.string().min(1).default('unknown'),
});
export type AdminConfig = z.infer<typeof adminConfigSchema>;

export function readAdminConfig(
  env: Readonly<Record<string, string | undefined>>,
): AdminConfig {
  const parsed = adminConfigSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid admin configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return parsed.data;
}

/** The release-only migrate app's one secret (ADR 0041 pattern). */
export function readAdminMigrationUrl(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const parsed = postgresUrl.safeParse(env.ADMIN_MIGRATION_DATABASE_URL);
  if (!parsed.success)
    throw new Error(
      'Invalid admin configuration: ADMIN_MIGRATION_DATABASE_URL',
    );
  return parsed.data;
}
