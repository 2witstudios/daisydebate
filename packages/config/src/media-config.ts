import { z } from 'zod';
import { secret } from './secrets';
import {
  mediaEndpoint,
  mediaEndpointList,
  mediaEndpointsOf,
} from './media-endpoint';
import { mediaWorkerSecret } from './credentials';

export const mediaFields = {
  LIVEKIT_URL: mediaEndpointList(/^https?$/).optional(),
  LIVEKIT_PUBLIC_URL: mediaEndpointList(/^wss?$/).optional(),
  LIVEKIT_API_KEY: secret(z.string().regex(/^\S+$/)).optional(),
  LIVEKIT_API_SECRET: secret(z.string().regex(/^\S+$/)).optional(),
  MEDIA_WORKER_SECRET: secret(mediaWorkerSecret).optional(),
  /**
   * ADR 0099: the Broadcast control plane runs only when this is exactly `on`.
   * Unset, merging or deploying this code captures nothing.
   */
  BROADCAST_CAPTURE: z.literal('on').optional(),
  /**
   * ADR 0107: Recording's capture sweep runs only when this is exactly `on`.
   * Unset, no Round is requested a Recording and no Egress starts for one.
   */
  RECORDING_CAPTURE: z.literal('on').optional(),
  /**
   * Where signed Recording reads point. Not a secret: every signed URL names it.
   * The replay page's browser policy names it, and no other page's does.
   */
  RECORDING_BUCKET_ENDPOINT: mediaEndpoint(/^https?$/).optional(),
  /**
   * The public bucket's read origin. Not a secret: every feed URL names it.
   * Unset, no Round offers an official feed.
   */
  BROADCAST_PUBLIC_ORIGIN: mediaEndpoint(/^https?$/).optional(),
};

export function refineMediaConfig(
  config: z.output<z.ZodObject<typeof mediaFields>>,
  ctx: z.RefinementCtx,
) {
  if (
    config.LIVEKIT_URL &&
    config.LIVEKIT_PUBLIC_URL &&
    mediaEndpointsOf(config.LIVEKIT_URL).length !==
      mediaEndpointsOf(config.LIVEKIT_PUBLIC_URL).length
  )
    ctx.addIssue({
      code: 'custom',
      path: ['LIVEKIT_PUBLIC_URL'],
      message: 'LIVEKIT_URL and LIVEKIT_PUBLIC_URL must list the same nodes',
    });
}
