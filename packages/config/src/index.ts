import { analyticsFields } from './analytics-config';
import {
  competitiveFields,
  requireCompetitiveBudget,
} from './competitive-config';
import { attendanceFields } from './attendance-config';
import {
  foundationFields,
  requireFoundationProofDisabled,
} from './foundation-config';
import { webOriginFields, requireHttpsOrigin } from './web-origin-config';
import { betaFields } from './beta-config';
import {
  realtimeEndpointFields,
  requireSecureRealtime,
} from './realtime-endpoint';
import { mediaFields, refineMediaConfig } from './media-config';
import { webTelemetryFields } from './telemetry-config';
import { authFields, signUpFields } from './auth-config';
import { mailFields } from './mail-config';
import { migrationFields } from './migration-config';
import { leagueRequestsFields } from './league-requests-config';
import { debateBotFields } from './debate-bot-config';

import {
  billingFields,
  billingEconomicsFields,
  hostEventPriceFields,
  clubBillingFields,
  refineBillingConfig,
  withBillingConfig,
} from './billing-config';
export type { BillingConfig, ClubBillingConfig } from './billing-config';
import { z } from 'zod';
import {
  messagingGroupFields,
  refineMessagingGroups,
} from './messaging-groups';
import { roomFields } from './room-policy';
import { messagingFields } from './messaging-policy';
import { contactsFields } from './contacts-policy';
import { roundAnalysisFields } from './round-analysis-policy';
export type { RoundBotWorkerPolicy } from './bot-worker-policy';
export type { RoundJudgingPolicy } from './judging-policy';
export type { RoundAnalysisPolicy } from './round-analysis-policy';
export type { MessagingPolicyOverride } from './messaging-policy';
export type { ContactsPolicyOverride } from './contacts-policy';
export { mediaEndpointsOf } from './media-endpoint';
import {
  deploymentIdentityFields,
  requireDeploymentIdentity,
} from './deployment-identity';
import { withoutMigrationCredential } from './credentials';
import { secretKeysOf } from './secrets';
import { mediaWorkerFields } from './media-worker-config';
import { operatorFields, refineOperatorConfig } from './operator-config';
import {
  refineReleaseFlagDefault,
  releaseFlagDefaultFields,
} from './release-flag-default';
export {
  readMediaWorkerConfig,
  type MediaWorkerConfig,
} from './media-worker-config';
export {
  readRealtimePublicUrl,
  realtimePublicUrlSchema,
} from './realtime-endpoint';
export { readRealtimeTransportConfig } from './realtime-transport';

export {
  requireAdminTestDatabase,
  requireTestClickHouse,
  requireTestServices,
  requireTestSlotServices,
} from './test-services';
export {
  expectedTestRedisDatabase,
  testRedisDatabase,
  testRedisRefusal,
} from './test-redis';

export {
  readTrustedProxyConfig,
  TRUSTED_PROXY_GATEWAY,
} from './trusted-proxies';

export { readBrowserConfig } from './web-origin-config';
export { readAuthConfig, type AuthConfig } from './auth-config';
export { readMailConfig, type MailConfig } from './mail-config';
export { readMigrationConfig } from './migration-config';
export { readRealtimeConfig } from './realtime-config';

const serverFields = {
  ...messagingGroupFields,
  ...billingFields,
  ...hostEventPriceFields,
  ...clubBillingFields,
  ...billingEconomicsFields,
  ...analyticsFields,
  ...signUpFields,
  ...competitiveFields,
  ...roundAnalysisFields,
  ...roomFields,
  ...messagingFields,
  ...contactsFields,
  ...attendanceFields,
  ...deploymentIdentityFields,
  ...foundationFields,
  ...webOriginFields,
  ...betaFields,
  ...leagueRequestsFields,
  ...operatorFields,
  ...releaseFlagDefaultFields,
  ...realtimeEndpointFields,
  ...mediaFields,
  ...debateBotFields,
  ...webTelemetryFields,
};
const serverConfigSchema = z
  .object(serverFields)
  .superRefine((config, ctx) => {
    refineMessagingGroups(config, ctx, 'web');
    refineBillingConfig(config, ctx);
    refineOperatorConfig(config, ctx);
    refineReleaseFlagDefault(config, ctx);
    requireCompetitiveBudget(config, ctx);
    refineMediaConfig(config, ctx);
    if (config.NODE_ENV !== 'production') return;
    requireHttpsOrigin(config.PUBLIC_APP_URL, ctx);
    requireDeploymentIdentity(config, ctx);
    requireSecureRealtime(config, ctx);
    requireFoundationProofDisabled(config, ctx);
  })
  .transform(withoutMigrationCredential)
  .transform(withBillingConfig);
export type ServerConfig = z.output<typeof serverConfigSchema>;
/** Validation reports field names only: never echo secret values. */
export function readServerConfig(
  env: Record<string, string | undefined>,
): ServerConfig {
  const result = serverConfigSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid server configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return result.data;
}
/**
 * Every configuration key marked secret in the server, realtime, auth,
 * media worker and migration schemas: the list the logger's redaction tests
 * are derived from (ADR 0019).
 */
export const secretConfigKeys = secretKeysOf({
  ...serverFields,
  ...authFields,
  ...mailFields,
  ...mediaWorkerFields,
  ...migrationFields,
});
