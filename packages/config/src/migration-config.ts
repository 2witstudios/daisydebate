import { z } from 'zod';
import { secret } from './secrets';
import { databaseUrl } from './urls';

/**
 * The migration runner's credential (ISSUE-39). Production (the release
 * command runs in the image, which sets NODE_ENV=production) migrates only
 * through MIGRATION_DATABASE_URL, the schema owner, and refuses one that
 * names the same role as the runtime DATABASE_URL, which production holds
 * as the DML-only `daisy_web`. Local and test databases have one owner
 * login, so outside production DATABASE_URL serves unless a migration
 * credential is named.
 */
export const migrationFields = {
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  MIGRATION_DATABASE_URL: secret(databaseUrl).optional(),
  DATABASE_URL: secret(databaseUrl).optional(),
};
const migrationConfigSchema = z
  .object(migrationFields)
  .superRefine((config, ctx) => {
    const production = config.NODE_ENV === 'production';
    const url = production
      ? config.MIGRATION_DATABASE_URL
      : (config.MIGRATION_DATABASE_URL ?? config.DATABASE_URL);
    if (url === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [production ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL'],
        message: 'required',
      });
      return;
    }
    if (!production) return;
    if (new URL(url).password === 'local-development-only')
      ctx.addIssue({
        code: 'custom',
        path: ['MIGRATION_DATABASE_URL'],
        message: 'production forbids local development credentials',
      });
    if (
      config.DATABASE_URL !== undefined &&
      new URL(config.DATABASE_URL).username === new URL(url).username
    )
      ctx.addIssue({
        code: 'custom',
        path: ['MIGRATION_DATABASE_URL'],
        message: 'must name a different role than DATABASE_URL',
      });
  })
  .transform((config) => ({
    databaseUrl: (config.NODE_ENV === 'production'
      ? config.MIGRATION_DATABASE_URL
      : (config.MIGRATION_DATABASE_URL ?? config.DATABASE_URL)) as string,
  }));
type MigrationConfig = z.infer<typeof migrationConfigSchema>;
/** Validation reports field names only: never echo secret values. */
export function readMigrationConfig(
  env: Record<string, string | undefined>,
): MigrationConfig {
  const result = migrationConfigSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid migration configuration: ${result.error.issues
        .map((issue) =>
          issue.code === 'custom' && issue.message !== 'required'
            ? `${issue.path.join('.')} (${issue.message})`
            : issue.path.join('.'),
        )
        .join(', ')}`,
    );
  return result.data;
}
