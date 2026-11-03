import { z } from 'zod';

/** Every field is required: absence refuses start, so nothing runs half configured. */
const schema = z.object({
  RECORDING_WORKER_DATABASE_URL: z.url(),
  /** The Egress hold: this worker reads sources and deletes them when done. */
  RECORDING_HOLD_ENDPOINT: z.url(),
  RECORDING_HOLD_BUCKET: z.string().min(1),
  RECORDING_HOLD_KEY: z.string().min(1),
  RECORDING_HOLD_SECRET: z.string().min(1),
  RECORDING_BUCKET_ENDPOINT: z.url(),
  RECORDING_BUCKET_NAME: z.string().min(1),
  RECORDING_BUCKET_ACCESS_KEY_ID: z.string().min(1),
  RECORDING_BUCKET_SECRET_ACCESS_KEY: z.string().min(1),
  RECORDING_BUCKET_REGION: z.string().min(1).default('auto'),
  /** One Recording at a time per slot; each uses every core it can get. */
  RECORDING_WORKER_SLOTS: z.coerce.number().int().min(1).max(8).default(1),
  RECORDING_WORK_DIR: z.string().min(1).default('/tmp/recording-worker'),
});

export const readWorkerConfig = (env: Record<string, string | undefined>) =>
  schema.parse(env);
