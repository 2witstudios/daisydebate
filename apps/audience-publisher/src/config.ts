import { z } from 'zod';

/** Every field is required: absence refuses start, so nothing runs half configured. */
const schema = z.object({
  AUDIENCE_PUBLISHER_DATABASE_URL: z.url(),
  BROADCAST_STORAGE_ENDPOINT: z.url(),
  BROADCAST_PUBLIC_BUCKET: z.string().min(1),
  BROADCAST_PUBLIC_KEY: z.string().min(1),
  BROADCAST_PUBLIC_SECRET: z.string().min(1),
  BROADCAST_PUBLIC_ORIGIN: z.url(),
  /** The same namespace as web, for the count its pulses gather. */
  REDIS_URL: z.url(),
  REDIS_NAMESPACE: z.string().min(1),
});

export const readPublisherConfig = (env: Record<string, string | undefined>) =>
  schema.parse(env);
