import {
  operatorAudienceSchema,
  operatorKeyIdSchema,
} from '@daisy/protocol/operator';
import { z } from 'zod';
import type { OperatorClientConfig } from './features/operator-client/client';
import type { LogStoreConfig } from './features/security/store';

/**
 * The admin app's environment, validated once at the process edge. Errors
 * name fields, never values. It holds no participant credential: no
 * DATABASE_URL, REDIS_URL or Better Auth secret (ADR 0077).
 */
const postgresUrl = z
  .string()
  .regex(/^postgres(?:ql)?:\/\/[^\s]+$/, 'must be a postgres:// URL');

const adminConfigSchema = z
  .object({
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
  })
  // Fail closed: Bun defaults NODE_ENV to development, which would serve Next
  // in dev mode and skip the role refusal, so only a loopback bind may run
  // outside production.
  .refine(
    ({ NODE_ENV, ADMIN_HOST }) =>
      NODE_ENV === 'production' || ADMIN_HOST === 'localhost',
    { path: ['NODE_ENV'], message: 'must be production off loopback' },
  );
export type AdminConfig = z.infer<typeof adminConfigSchema>;

/** Parses settings or refuses startup, naming fields and never values. */
function parseOrRefuse<T>(
  schema: z.ZodType<T>,
  env: Readonly<Record<string, string | undefined>>,
): T {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid admin configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return parsed.data;
}

export function readAdminConfig(
  env: Readonly<Record<string, string | undefined>>,
): AdminConfig {
  return parseOrRefuse(adminConfigSchema, env);
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

const operatorKeys = [
  'OPERATOR_API_URL',
  'OPERATOR_API_KEY_ID',
  'OPERATOR_API_KEY',
  'OPERATOR_AUDIENCE',
] as const;

const operatorClientSchema = z.object({
  OPERATOR_API_URL: z.url({ protocol: /^https?$/ }),
  OPERATOR_API_KEY_ID: operatorKeyIdSchema,
  // base64url of at least 32 bytes (ADR 0079); a Fly secret, never in [env].
  OPERATOR_API_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((value) => Buffer.from(value, 'base64url').byteLength >= 32),
  OPERATOR_AUDIENCE: operatorAudienceSchema,
});

/**
 * An optional group of settings: null when none of its keys is set, the
 * parsed group when it is complete and valid, and a startup refusal naming
 * fields (never values) for anything in between.
 */
function allOrNone<T>(
  keys: readonly string[],
  schema: z.ZodType<T>,
  env: Readonly<Record<string, string | undefined>>,
): T | null {
  return keys.every((name) => env[name] === undefined)
    ? null
    : parseOrRefuse(schema, env);
}

/**
 * The signing client's settings (ADR 0079), all four or none: none leaves
 * the accounts screen unconfigured, and a partial set refuses startup
 * rather than half-loading.
 */
export function readOperatorClientConfig(
  env: Readonly<Record<string, string | undefined>>,
): OperatorClientConfig | null {
  const data = allOrNone(operatorKeys, operatorClientSchema, env);
  return (
    data && {
      baseUrl: data.OPERATOR_API_URL,
      keyId: data.OPERATOR_API_KEY_ID,
      key: new Uint8Array(Buffer.from(data.OPERATOR_API_KEY, 'base64url')),
      audience: data.OPERATOR_AUDIENCE,
    }
  );
}

const logStoreKeys = ['CLICKHOUSE_URL', 'CLICKHOUSE_READER_PASSWORD'] as const;
const logStoreSchema = z.object({
  CLICKHOUSE_URL: z.url({ protocol: /^https?$/ }),
  // A Fly secret, never in [env] (ADR 0081).
  CLICKHOUSE_READER_PASSWORD: z.string().min(32),
});

/**
 * The log store's read-only connection (ADR 0081), both or neither: neither
 * leaves the Security page unconfigured, and one alone refuses startup.
 */
export function readLogStoreConfig(
  env: Readonly<Record<string, string | undefined>>,
): LogStoreConfig | null {
  const data = allOrNone(logStoreKeys, logStoreSchema, env);
  return (
    data && {
      url: data.CLICKHOUSE_URL,
      password: data.CLICKHOUSE_READER_PASSWORD,
    }
  );
}
