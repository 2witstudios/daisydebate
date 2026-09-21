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
// RFC 9110 field-name token: anything else makes `Headers.get` throw.
const headerName = z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/);
// IPv6 that embeds IPv4: dotted notation, or the IPv4-mapped block ::ffff:0:0/96
// written in hex (only zero groups, then ffff, then exactly two groups).
const embedsIpv4 = (value: string) =>
  value.includes('.') ||
  /^[0:]*:ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(value.split('/')[0] ?? '');
// The accepted set must stay a subset of what Better Auth acts on: it drops
// an entry it cannot parse with only a warning, quietly untrusting a real
// proxy. It reduces IPv4-mapped IPv6 to four bytes and caps that prefix at
// 32, so mapped ranges are refused outright; operators write the IPv4 form.
// Stricter than Better Auth on purpose (no leading-zero prefixes either).
const proxyAddress = z.union([
  z.ipv4(),
  z.cidrv4(),
  z.union([z.ipv6(), z.cidrv6()]).refine((value) => !embedsIpv4(value)),
]);
/** Optional comma-separated list: absent or blank means an empty list. */
const commaList = (entry: z.ZodType<string, string>) =>
  z
    .string()
    .default('')
    .transform((value) =>
      value.trim() === '' ? [] : value.split(',').map((item) => item.trim()),
    )
    .pipe(z.array(entry));
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
    /**
     * Request headers believed to name the client address for rate-limit
     * keying. Set only to the header the deployment's own reverse proxy
     * overwrites; the default believes none.
     */
    AUTH_TRUSTED_IP_HEADERS: commaList(headerName),
    /** Proxy IPs or CIDR ranges skipped when a trusted header holds a chain. */
    AUTH_TRUSTED_PROXIES: commaList(proxyAddress),
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
