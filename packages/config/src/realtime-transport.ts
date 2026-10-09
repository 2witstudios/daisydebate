import { z } from 'zod';
const list = z
  .string()
  .default('')
  .transform((value) =>
    value.trim() ? value.split(',').map((item) => item.trim()) : [],
  );
const origin = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
});
const positive = (fallback: number) =>
  z.coerce.number().int().positive().max(10_000).default(fallback);
const schema = z.object({
  REALTIME_ALLOWED_ORIGINS: list.pipe(z.array(origin)),
  REALTIME_MAX_SUBSCRIPTIONS: positive(64),
  REALTIME_MAX_IP_CONNECTIONS: positive(20),
  REALTIME_MAX_UNAUTHENTICATED: positive(4),
  REALTIME_MAX_ACTOR_CONNECTIONS: positive(8),
  REALTIME_RING_LIMIT: positive(2_000),
});
/** Local transport resource tuning, never authorization policy or membership. */
export function readRealtimeTransportConfig(
  env: Readonly<Record<string, string | undefined>>,
) {
  const parsed = schema.safeParse({
    ...env,
    REALTIME_ALLOWED_ORIGINS:
      env.REALTIME_ALLOWED_ORIGINS ?? env.PUBLIC_APP_URL,
  });
  if (!parsed.success)
    throw new Error(
      `Invalid realtime transport configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return {
    allowedOrigins: parsed.data.REALTIME_ALLOWED_ORIGINS,
    maxSubscriptions: parsed.data.REALTIME_MAX_SUBSCRIPTIONS,
    maxPerIp: parsed.data.REALTIME_MAX_IP_CONNECTIONS,
    maxUnauthenticated: parsed.data.REALTIME_MAX_UNAUTHENTICATED,
    maxPerActor: parsed.data.REALTIME_MAX_ACTOR_CONNECTIONS,
    ringLimit: parsed.data.REALTIME_RING_LIMIT,
  };
}
