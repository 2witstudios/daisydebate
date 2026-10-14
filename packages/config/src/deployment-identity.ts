import { z } from 'zod';
import { databaseUrl, redisUrl } from './urls';

/**
 * Fields whose value is a credential or carries one (a password inside a
 * connection URL). Marked where each field is declared, so the list of
 * secret keys is derived from the schemas rather than kept by hand.
 */
export const secrets = z.registry<{ readonly secret: true }>();
export const secret = <Schema extends z.ZodType>(schema: Schema): Schema => {
  secrets.add(schema, { secret: true });
  return schema;
};

/**
 * Shared across every deployment's config schema (`readServerConfig`,
 * `readRealtimeConfig`): production refuses to boot without a real
 * `APP_VERSION`/`GIT_COMMIT` and never against local-development
 * PostgreSQL credentials.
 */
export const requireDeploymentIdentity = (
  config: {
    APP_VERSION: string;
    GIT_COMMIT: string;
    DATABASE_URL: string;
    MIGRATION_DATABASE_URL?: string | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  // ISSUE-102: the schema owner lives only in the release-only migrator app
  // (ADR 0041); a runtime machine holding it is a misplaced Fly secret.
  if (config.MIGRATION_DATABASE_URL !== undefined)
    ctx.addIssue({
      code: 'custom',
      path: ['MIGRATION_DATABASE_URL'],
      message: 'Production runtime must not hold the migration credential',
    });
  if (config.APP_VERSION === 'development' || config.GIT_COMMIT === 'unknown')
    ctx.addIssue({
      code: 'custom',
      path: ['APP_VERSION'],
      message: 'Production requires deployment identity',
    });
  if (new URL(config.DATABASE_URL).password === 'local-development-only')
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'Production forbids local development credentials',
    });
};
export const deploymentIdentityFields = {
  // Required, no default: an unset NODE_ENV must refuse to start rather than
  // silently become 'development' and skip every production check below.
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: secret(databaseUrl),
  REDIS_URL: secret(redisUrl),
  REDIS_NAMESPACE: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,40}$/)
    .default('daisy'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  APP_VERSION: z.string().min(1).default('development'),
  GIT_COMMIT: z.string().min(1).default('unknown'),
  // Read only so production can refuse it; never part of the parsed config.
  MIGRATION_DATABASE_URL: secret(z.string()).optional(),
};
/** Drops the migration credential a runtime reads only to refuse it. */
export const withoutMigrationCredential = <Config extends object>(
  config: Config & { MIGRATION_DATABASE_URL?: string | undefined },
): Omit<Config, 'MIGRATION_DATABASE_URL'> => {
  const { MIGRATION_DATABASE_URL: refused, ...runtime } = config;
  void refused;
  return runtime;
};
export const unwrapOptional = (schema: z.ZodType): z.ZodType =>
  schema instanceof z.ZodOptional
    ? unwrapOptional(schema.unwrap() as z.ZodType)
    : schema;
