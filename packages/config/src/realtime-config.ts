import { z } from 'zod';
import { databaseUrl } from './urls';
import {
  deploymentIdentityFields,
  requireDeploymentIdentity,
  secret,
  withoutMigrationCredential,
} from './deployment-identity';

/**
 * `apps/realtime`'s baseline configuration (ADR 0031): no public origin and
 * no foundation-proof flag, neither of which the realtime deployment has a
 * use for yet.
 */
export const realtimeFields = {
  ...deploymentIdentityFields,
  // Present only on the bounded eligible subset: the narrow projection
  // role's credential for headers, shared bodies and the metadata relay.
  OBSERVATION_DATABASE_URL: secret(databaseUrl).optional(),
};
const realtimeConfigSchema = z
  .object(realtimeFields)
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;
    requireDeploymentIdentity(config, ctx);
    const projection = config.OBSERVATION_DATABASE_URL;
    if (
      projection !== undefined &&
      // The narrow credential is a different role, not a reworded URL.
      (new URL(projection).username === new URL(config.DATABASE_URL).username ||
        new URL(projection).password === 'local-development-only')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['OBSERVATION_DATABASE_URL'],
        message: 'Production projection requires its own narrow credential',
      });
  })
  .transform(withoutMigrationCredential);
export type RealtimeConfig = z.output<typeof realtimeConfigSchema>;
/** Validation reports field names only: never echo secret values. */
export function readRealtimeConfig(
  env: Record<string, string | undefined>,
): RealtimeConfig {
  const result = realtimeConfigSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid realtime configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return result.data;
}
