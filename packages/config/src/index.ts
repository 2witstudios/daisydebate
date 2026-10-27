import { signUpMailCeilingsConfig } from './sign-up-mail-ceilings';
import { z } from 'zod';
import { databaseUrl } from './urls';
import { roomPolicyConfig } from './room-policy';
import { botWorkerPolicyConfig } from './bot-worker-policy';
import { judgingPolicyConfig } from './judging-policy';
import { roundAnalysisPolicyConfig } from './round-analysis-policy';
export type { RoundBotWorkerPolicy } from './bot-worker-policy';
export type { RoundJudgingPolicy } from './judging-policy';
export type { RoundAnalysisPolicy } from './round-analysis-policy';
import { mediaEndpoint } from './media-endpoint';
import {
  deploymentIdentityFields,
  requireDeploymentIdentity,
} from './deployment-identity';
import { realtimePublicUrlSchema } from './realtime-endpoint';
import { mediaWorkerSecret, withoutMigrationCredential } from './credentials';
import { secret, secretKeysOf } from './secrets';
import { mediaWorkerFields } from './media-worker-config';
import { operatorFields, refineOperatorConfig } from './operator-config';
import { trustedProxyList } from './trusted-proxies';
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

const requireHttpsOrigin = (url: string, ctx: z.RefinementCtx) => {
  if (!url.startsWith('https:'))
    ctx.addIssue({
      code: 'custom',
      path: ['PUBLIC_APP_URL'],
      message: 'Production requires HTTPS',
    });
};
const serverFields = {
  AUTH_SIGN_UP_MAIL_CEILINGS: signUpMailCeilingsConfig,
  AI_ROUND_BUSY_CAP: z.coerce.number().int().positive().optional(),
  /** DEC-183 as amended (ISSUE-646): AI Rounds per approved beta host per UTC calendar month. */
  AI_ROUND_MONTHLY_CAP: z.coerce.number().int().min(1).max(1000).default(20),
  /**
   * Concurrent provider calls for competitive work: AI judging and live bot
   * speech share this one budget. Round analysis has its own.
   */
  COMPETITIVE_PROVIDER_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .max(64)
    .optional(),
  ROUND_BOT_WORKER_POLICY: botWorkerPolicyConfig,
  ROUND_JUDGING_POLICY: judgingPolicyConfig,
  ROUND_ANALYSIS_POLICY: roundAnalysisPolicyConfig,
  /** DEC-247: beta-sourced round analysis grants count as premium; false at launch. */
  PREMIUM_BETA_GRANT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  ROOM_POLICY: roomPolicyConfig,
  /** Configured isolated member/session resource for the actual public check-in probe. */
  ATTENDANCE_PUBLIC_PROBE: secret(z.string()).optional(),
  ...deploymentIdentityFields,
  FOUNDATION_PROOF_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PUBLIC_APP_URL: z.url(),
  /**
   * ADR 0075: where the owner's beta request digest goes. Personal data, so
   * it is set in the deploy's secret store, never committed; absent, owed
   * digests are cancelled as unconfigured.
   */
  BETA_NOTIFY_EMAIL: z.email().optional(),
  ...operatorFields,
  REALTIME_PUBLIC_URL: realtimePublicUrlSchema.optional(),
  LIVEKIT_URL: mediaEndpoint(/^https?$/).optional(),
  LIVEKIT_PUBLIC_URL: mediaEndpoint(/^wss?$/).optional(),
  LIVEKIT_API_KEY: secret(z.string().regex(/^\S+$/)).optional(),
  LIVEKIT_API_SECRET: secret(z.string().regex(/^\S+$/)).optional(),
  MEDIA_WORKER_SECRET: secret(mediaWorkerSecret).optional(),
  // AIDB: OpenRouter for AI debates (chat, TTS, STT). Optional: without it
  // AI debates are unavailable and nothing calls out.
  OPENROUTER_API_KEY: secret(z.string().regex(/^\S+$/)).optional(),
};
const serverConfigSchema = z
  .object(serverFields)
  .superRefine((config, ctx) => {
    refineOperatorConfig(config, ctx);
    if (config.NODE_ENV !== 'production') return;
    requireHttpsOrigin(config.PUBLIC_APP_URL, ctx);
    requireDeploymentIdentity(config, ctx);
    if (
      config.REALTIME_PUBLIC_URL !== undefined &&
      !config.REALTIME_PUBLIC_URL.startsWith('wss:')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['REALTIME_PUBLIC_URL'],
        message: 'Production requires WSS',
      });
    if (config.FOUNDATION_PROOF_ENABLED)
      ctx.addIssue({
        code: 'custom',
        path: ['FOUNDATION_PROOF_ENABLED'],
        message: 'Foundation proof is development-only',
      });
  })
  .transform(withoutMigrationCredential);
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
 * `apps/realtime`'s baseline configuration (ADR 0031): no public origin and
 * no foundation-proof flag, neither of which the realtime deployment has a
 * use for yet.
 */
const realtimeConfigSchema = z
  .object(deploymentIdentityFields)
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;
    requireDeploymentIdentity(config, ctx);
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
/**
 * Narrow server authentication configuration, validated only when the auth
 * composition is activated: baseline startup never requires auth variables.
 */
const authFields = {
  AUTH_SIGN_UP_MAIL_CEILINGS: signUpMailCeilingsConfig,
  /** 64 characters from 32 random bytes (hex); see `bun auth:provision`. */
  BETTER_AUTH_SECRET: secret(z.string().regex(/^\S{64}$/)),
  /**
   * 64 characters from 32 random bytes (hex); see `bun auth:provision`.
   * Keys `recipientKey` (the suppression ledger and per-recipient
   * rate-limit buckets) independently of `BETTER_AUTH_SECRET`, so rotating
   * the session-signing secret can never desynchronize them (ADR 0044,
   * ISSUE-141).
   */
  RECIPIENT_HASH_SECRET: secret(z.string().regex(/^\S{64}$/)),
  PUBLIC_APP_URL: z.url().refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Expected HTTP(S) URL'),
  RESEND_API_KEY: secret(z.string().regex(/^\S+$/)),
  /** Sender email header value; newlines and malformed mailboxes are rejected. */
  AUTH_EMAIL_FROM: z
    .string()
    .refine(
      (value) =>
        /^(?:[^<>\r\n]+ <[^\s@<>]+@[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+)$/.test(
          value,
        ),
      'Expected an email address or display name with an email address',
    ),
  /** Resend (Svix) signing secret for delivery webhooks; required in production. */
  RESEND_WEBHOOK_SECRET: secret(
    z.string().regex(/^whsec_[A-Za-z0-9+/=]{16,}$/),
  ).optional(),
  /** Proxy IPs or CIDR ranges skipped when a trusted header holds a chain. */
  AUTH_TRUSTED_PROXIES: trustedProxyList,
  /**
   * Bearer credential for the read-only `/api/ops/alerts` and
   * `/api/ops/metrics` probes (AUTH-7.7); required in production so the
   * scheduled alert workflow, and nothing else, can read them.
   */
  OPS_PROBE_TOKEN: secret(z.string().min(32)).optional(),
  // Required, no default: see deploymentIdentityFields.NODE_ENV.
  NODE_ENV: z.enum(['development', 'test', 'production']),
};
/** Fields that must be set once NODE_ENV is production, each reported by name only. */
const REQUIRED_IN_PRODUCTION = [
  ['RESEND_WEBHOOK_SECRET', 'Production requires the webhook signing secret'],
  ['OPS_PROBE_TOKEN', 'Production requires the ops probe token'],
] as const;
const authConfigSchema = z
  .object(authFields)
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;
    requireHttpsOrigin(config.PUBLIC_APP_URL, ctx);
    for (const [field, message] of REQUIRED_IN_PRODUCTION)
      if (config[field] === undefined)
        ctx.addIssue({ code: 'custom', path: [field], message });
  })
  .transform(({ NODE_ENV: _nodeEnv, ...auth }) => auth);
export type AuthConfig = z.infer<typeof authConfigSchema>;
/** Validation reports field names only: never echo secret values. */
export function readAuthConfig(
  env: Record<string, string | undefined>,
): AuthConfig {
  const result = authConfigSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid auth configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return result.data;
}
/**
 * The migration runner's credential (ISSUE-39). Production (the release
 * command runs in the image, which sets NODE_ENV=production) migrates only
 * through MIGRATION_DATABASE_URL, the schema owner, and refuses one that
 * names the same role as the runtime DATABASE_URL, which production holds
 * as the DML-only `daisy_web`. Local and test databases have one owner
 * login, so outside production DATABASE_URL serves unless a migration
 * credential is named.
 */
const migrationFields = {
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
export type MigrationConfig = z.infer<typeof migrationConfigSchema>;
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
export function readBrowserConfig(env: Record<string, string | undefined>) {
  return z
    .object({ PUBLIC_APP_URL: z.url() })
    .parse({ PUBLIC_APP_URL: env.PUBLIC_APP_URL });
}
/**
 * Every configuration key marked secret in the server, realtime, auth,
 * media worker and migration schemas: the list the logger's redaction tests
 * are derived from (ADR 0019).
 */
export const secretConfigKeys = secretKeysOf({
  ...serverFields,
  ...authFields,
  ...mediaWorkerFields,
  ...migrationFields,
});
