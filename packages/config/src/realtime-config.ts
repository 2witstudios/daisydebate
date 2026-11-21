import { z } from 'zod';
import { withoutMigrationCredential } from './credentials';
import {
  deploymentIdentityFields,
  requireDeploymentIdentity,
} from './deployment-identity';
import { serverTelemetryFields } from './telemetry-config';

/**
 * `apps/realtime`'s baseline configuration (ADR 0031): no public origin and
 * no foundation-proof flag, neither of which the realtime deployment has a
 * use for yet.
 */
const realtimeConfigSchema = z
  .object({
    ...deploymentIdentityFields,
    ...serverTelemetryFields,
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;
    requireDeploymentIdentity(config, ctx);
  })
  .transform(withoutMigrationCredential);
type RealtimeConfig = z.output<typeof realtimeConfigSchema>;
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
