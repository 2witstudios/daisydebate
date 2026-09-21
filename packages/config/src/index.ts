import { z } from 'zod';

const databaseUrl = z
  .url()
  .refine(
    (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
    'Expected PostgreSQL URL',
  );
const redisUrl = z
  .url()
  .refine(
    (value) => ['redis:', 'rediss:'].includes(new URL(value).protocol),
    'Expected Redis URL',
  );
export const serverConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URL: databaseUrl,
    FOUNDATION_PROOF_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    REDIS_URL: redisUrl,
    REDIS_NAMESPACE: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,40}$/)
      .default('daisy'),
    PUBLIC_APP_URL: z.url(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_VERSION: z.string().min(1).default('development'),
    GIT_COMMIT: z.string().min(1).default('unknown'),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;
    if (!config.PUBLIC_APP_URL.startsWith('https:'))
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_APP_URL'],
        message: 'Production requires HTTPS',
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
    if (config.FOUNDATION_PROOF_ENABLED)
      ctx.addIssue({
        code: 'custom',
        path: ['FOUNDATION_PROOF_ENABLED'],
        message: 'Foundation proof is development-only',
      });
  });
export type ServerConfig = z.infer<typeof serverConfigSchema>;
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
const ipv4 = z.ipv4();
const ipv6 = z.ipv6();
/** IPv4/IPv6 address or CIDR range; a malformed entry must never behave like a non-match. */
const isIpOrCidr = (value: string) => {
  const [address = '', prefix, ...rest] = value.split('/');
  if (rest.length > 0) return false;
  const version = ipv4.safeParse(address).success
    ? 32
    : ipv6.safeParse(address).success
      ? 128
      : 0;
  if (version === 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= version;
};
/**
 * Narrow server authentication configuration, validated only when the auth
 * composition is activated: baseline startup never requires auth variables.
 */
export const authConfigSchema = z
  .object({
    /** 64 characters from 32 random bytes (hex); see `bun auth:provision`. */
    BETTER_AUTH_SECRET: z.string().regex(/^\S{64}$/),
    PUBLIC_APP_URL: z.url().refine((value) => {
      try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, 'Expected HTTP(S) URL'),
    RESEND_API_KEY: z.string().regex(/^\S+$/),
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
    RESEND_WEBHOOK_SECRET: z
      .string()
      .regex(/^whsec_[A-Za-z0-9+/=]{16,}$/)
      .optional(),
    /**
     * Deployment ingress hops (comma-separated IP/CIDR) whose forwarding
     * headers are honored. Empty/absent: only the socket peer identifies a
     * client and every forwarding header is ignored.
     */
    AUTH_TRUSTED_PROXIES: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      )
      .refine(
        (entries) => entries.every(isIpOrCidr),
        'Expected IP or CIDR list',
      )
      .optional(),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;
    if (!config.PUBLIC_APP_URL.startsWith('https:'))
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_APP_URL'],
        message: 'Production requires HTTPS',
      });
    if (config.RESEND_WEBHOOK_SECRET === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_WEBHOOK_SECRET'],
        message: 'Production requires the webhook signing secret',
      });
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
export function readBrowserConfig(env: Record<string, string | undefined>) {
  return z
    .object({ PUBLIC_APP_URL: z.url() })
    .parse({ PUBLIC_APP_URL: env.PUBLIC_APP_URL });
}
export function readTestConfig(env: Record<string, string | undefined>) {
  return z
    .object({
      TEST_DATABASE_URL: databaseUrl.refine(
        (value) => new URL(value).pathname.endsWith('_test'),
        'Test database must end in _test',
      ),
      TEST_REDIS_URL: redisUrl,
    })
    .parse(env);
}
