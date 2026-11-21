import { z } from 'zod';
import { secret } from './secrets';
import { signUpMailCeilingsConfig } from './sign-up-mail-ceilings';
import { trustedProxyList } from './trusted-proxies';
import { requireHttpsOrigin } from './web-origin-config';

/**
 * Narrow server authentication configuration, validated only when the auth
 * composition is activated: baseline startup never requires auth variables.
 */
export const signUpFields = {
  AUTH_SIGN_UP_MAIL_CEILINGS: signUpMailCeilingsConfig,
};

export const authFields = {
  ...signUpFields,
  /** 64 characters from 32 random bytes (hex); see `bun auth:provision`. */
  BETTER_AUTH_SECRET: secret(z.string().regex(/^\S{64}$/)),
  PUBLIC_APP_URL: z.url().refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Expected HTTP(S) URL'),
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
