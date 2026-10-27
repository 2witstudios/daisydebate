import { z } from 'zod';

/**
 * The shipper's environment, validated once at the process edge. Errors
 * name fields, never values. NATS_TOKEN (a read-only org token) and
 * CLICKHOUSE_SHIPPER_PASSWORD are Fly secrets (docs/operations/log-pipeline.md).
 */
const appName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const shipperConfigSchema = z.object({
  NATS_URL: z
    .string()
    .regex(/^nats:\/\/[^\s]+$/)
    .default('nats://[fdaa::3]:4223'),
  FLY_ORG: appName,
  NATS_TOKEN: z.string().min(20),
  SHIPPER_APPS: z
    .string()
    .transform((value) => value.split(',').map((name) => name.trim()))
    .pipe(z.array(appName).min(1)),
  CLICKHOUSE_URL: z.url({ protocol: /^https?$/ }),
  CLICKHOUSE_SHIPPER_PASSWORD: z.string().min(32),
  APP_VERSION: z.string().min(1).default('development'),
  GIT_COMMIT: z.string().min(1).default('unknown'),
});
export type ShipperConfig = z.infer<typeof shipperConfigSchema>;

export function readShipperConfig(
  env: Readonly<Record<string, string | undefined>>,
): ShipperConfig {
  const parsed = shipperConfigSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid log shipper configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return parsed.data;
}

/** One subject per configured app: `logs.<app>.<region>.<instance>`. */
export const subjectsFor = (apps: readonly string[]) =>
  apps.map((app) => `logs.${app}.>`);
