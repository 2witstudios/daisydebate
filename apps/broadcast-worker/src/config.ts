import { z } from 'zod';

/** Every field is required: absence refuses start, so nothing runs half configured. */
const schema = z.object({
  BROADCAST_WORKER_DATABASE_URL: z.url(),
  BROADCAST_STORAGE_ENDPOINT: z.url(),
  BROADCAST_HOLD_BUCKET: z.string().min(1),
  BROADCAST_HOLD_KEY: z.string().min(1),
  BROADCAST_HOLD_SECRET: z.string().min(1),
  BROADCAST_PUBLIC_BUCKET: z.string().min(1),
  BROADCAST_PUBLIC_KEY: z.string().min(1),
  BROADCAST_PUBLIC_SECRET: z.string().min(1),
  BROADCAST_WORKER_SLOTS: z.coerce.number().int().min(1).max(32).default(4),
});

export const readWorkerConfig = (env: Record<string, string | undefined>) =>
  schema.parse(env);
