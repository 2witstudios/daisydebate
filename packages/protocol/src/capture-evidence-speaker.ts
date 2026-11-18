import { z } from 'zod';
import { idSchema } from './primitives';
import { seatRefSchema } from './seats';
/** Original authorized publishing-seat identity, not acoustic identity or evidence of hearing. */
export const captureEvidenceSpeakerSchema = z.strictObject({
  roundParticipantId: idSchema,
  actorId: idSchema,
  kind: z.enum(['human', 'bot']),
  /** A speaking seat: never a judge's. */
  seat: seatRefSchema.refine((seat) => seat.kind !== 'judge', {
    message: 'A judge never publishes speech',
  }),
});
export type CaptureEvidenceSpeaker = z.infer<
  typeof captureEvidenceSpeakerSchema
>;
