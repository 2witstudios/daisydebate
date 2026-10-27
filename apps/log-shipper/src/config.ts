import { z } from 'zod';
import { flyAppName } from './envelope';

/**
 * The shipper's environment, validated once at the process edge. Errors
 * name fields, never values. NATS_TOKEN (a read-only org token) and
 * CLICKHOUSE_SHIPPER_PASSWORD are Fly secrets (docs/operations/log-pipeline.md).
 */
const shipperConfigSchema = z.object({
  NATS_URL: z
    .string()
    .regex(/^nats:\/\/[^\s]+$/)
    .default('nats://[fdaa::3]:4223'),
  FLY_ORG: flyAppName,
  NATS_TOKEN: z.string().min(20),
  SHIPPER_APPS: z
    .string()
    // Each app once: a repeated app would subscribe twice and store every
    // line twice under two batch tokens.
    .transform((value) => [
      ...new Set(value.split(',').map((name) => name.trim())),
    ])
    .pipe(z.array(flyAppName).min(1)),
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

/**
 * One subscription per configured app, all in one queue group: however many
 * shipper machines overlap (a scale-up, a clone, a rolling deploy), each
 * record reaches exactly one of them, so no record is inserted twice under
 * two batch tokens.
 */
const SHIPPER_QUEUE = 'daisy-log-shipper';
export const subscriptionsFor = (apps: readonly string[]) =>
  apps.map((app) => ({ subject: `logs.${app}.>`, queue: SHIPPER_QUEUE }));
