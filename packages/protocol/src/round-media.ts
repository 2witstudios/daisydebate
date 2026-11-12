import { z } from 'zod';
import { idSchema } from './primitives';

const roundMediaGrantsSchema = z.strictObject({
  publish: z
    .array(z.enum(['camera', 'microphone']))
    .max(2)
    .refine((sources) => new Set(sources).size === sources.length),
  subscribe: z.boolean(),
  hidden: z.boolean(),
  capture: z.literal(false),
});

/** Private to the authenticated viewer. A judge's identity never enters peers. */
export const roundMediaStateSchema = z.strictObject({
  version: z.literal(1),
  roundId: idSchema,
  state: z.enum(['ready', 'ended', 'unavailable']),
  /** The session's current vendor room, which its token already names (ADR 0110). */
  mediaRoomName: idSchema,
  grants: roundMediaGrantsSchema,
  peers: z.array(
    z.strictObject({
      participantId: idSchema,
      identity: idSchema,
      microphone: z.boolean(),
    }),
  ),
  /**
   * The human judges on a post-round call (ADR 0126), by seat and never by
   * name. Absent at any other time: a judge is hidden throughout the Round.
   */
  callJudges: z
    .array(
      z.strictObject({
        slot: z.int().nonnegative(),
        identity: idSchema,
        microphone: z.boolean(),
      }),
    )
    .optional(),
});
export const roundMediaAdmissionSchema = roundMediaStateSchema.safeExtend({
  state: z.literal('ready'),
  identity: idSchema,
  url: z
    .url({ protocol: /^wss$/ })
    .refine((value) => /^wss:\/\/[^/?#@\\]+(?:[/?#]|$)/.test(value)),
  token: z.string().min(1).max(16384),
  expiresAt: z.iso.datetime({ offset: true }),
  /** `broadcast` adds a top layer for the stage; a browser that cannot afford it stays standard. */
  camera: z.enum(['standard', 'broadcast']),
});
export type RoundMediaState = z.infer<typeof roundMediaStateSchema>;
export type RoundMediaAdmission = z.infer<typeof roundMediaAdmissionSchema>;
