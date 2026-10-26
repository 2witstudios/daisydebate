import { z } from 'zod';
import { mediaWorkerSecret } from './credentials';
import { secret } from './secrets';
import { databaseUrl } from './urls';

/**
 * `apps/media-worker` (ADR 0053, VIDEO-3.10): its own least-privilege
 * database login, the web origin it posts signed capture to, the signing key
 * and the STT capability. It holds no LiveKit key: the web broker mints its
 * hidden receive-only token. Every field without a default is required;
 * absence refuses start.
 */
export const mediaWorkerFields = {
  NODE_ENV: z.enum(['development', 'test', 'production']),
  MEDIA_WORKER_DATABASE_URL: secret(databaseUrl),
  PUBLIC_APP_URL: z.url(),
  MEDIA_WORKER_SECRET: secret(mediaWorkerSecret),
  OPENROUTER_API_KEY: secret(z.string().regex(/^\S+$/)),
  MEDIA_WORKER_MAX_SESSIONS: z.coerce.number().int().min(1).max(64).default(8),
  // Built into the image (apps/web/Dockerfile) so worker logs name the release.
  APP_VERSION: z.string().min(1).default('development'),
  GIT_COMMIT: z.string().min(1).default('unknown'),
};
const mediaWorkerConfigSchema = z
  .object(mediaWorkerFields)
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;
    if (!config.PUBLIC_APP_URL.startsWith('https:'))
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_APP_URL'],
        message: 'Production requires HTTPS',
      });
    if (
      new URL(config.MEDIA_WORKER_DATABASE_URL).password.endsWith(
        'loopback-only',
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_WORKER_DATABASE_URL'],
        message: 'Production forbids local development credentials',
      });
  });
export type MediaWorkerConfig = z.output<typeof mediaWorkerConfigSchema>;
/** Validation reports field names only: never echo secret values. */
export function readMediaWorkerConfig(
  env: Record<string, string | undefined>,
): MediaWorkerConfig {
  const result = mediaWorkerConfigSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid media worker configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return result.data;
}
