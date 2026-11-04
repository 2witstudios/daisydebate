import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { z } from 'zod';
import { TrackSource } from 'livekit-server-sdk';

/** Vendor adapter input, not competitive authority or a shared CAP contract. */
export const permissionSchema = z
  .strictObject({
    publish: z.array(z.enum(['camera', 'microphone'])).max(2),
    subscribe: z.boolean(),
    capture: z.boolean(),
    hidden: z.boolean().optional(),
  })
  .refine((value) => new Set(value.publish).size === value.publish.length)
  .refine(
    (value) => !value.capture || (value.subscribe && !value.publish.length),
  );
export type MediaPermissions = z.infer<typeof permissionSchema>;
export const joinSchema = permissionSchema.safeExtend({
  room: idSchema,
  identity: idSchema,
});
export type MediaJoin = z.infer<typeof joinSchema>;
export const configSchema = z.strictObject({
  url: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }),
  apiKey: z.string().regex(/^\S+$/),
  apiSecret: z.string().regex(/^\S+$/),
});
export type MediaConfig = z.infer<typeof configSchema>;

/** LiveKit's ParticipantInfo.Kind for an agent; the server SDK does not export the enum. */
export const AGENT_PARTICIPANT_KIND = 4;

/**
 * The Broadcast observer's one identity: hidden, subscribe-only, in no roster
 * (ADR 0099). It is no debater's participant, so a Room's roster leaves it out.
 */
export const OBSERVER_IDENTITY = 'stage-observer';

export const participantSchema = z.object({
  identity: idSchema,
  /** What the participant's token says it is: only capture's token says agent. */
  kind: z.number().default(0),
  tracks: z
    .array(z.object({ sid: z.string(), source: z.enum(TrackSource) }))
    .default([]),
  permission: z.object({
    canPublish: z.boolean(),
    canSubscribe: z.boolean(),
    canPublishData: z.boolean(),
    canPublishSources: z.array(z.enum(TrackSource)),
    canUpdateMetadata: z.boolean(),
    hidden: z.boolean(),
  }),
});

export function parseMedia<T>(
  schema: z.ZodType<T>,
  input: unknown,
  config = false,
): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw createAppError(config ? 'INFRASTRUCTURE' : 'VALIDATION');
  return result.data;
}
