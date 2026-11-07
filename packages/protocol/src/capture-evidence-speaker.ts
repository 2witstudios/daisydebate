import { z } from 'zod';
import { idSchema } from './primitives';
import { MAX_FORMAT_SEATS } from './format';
/** Original authorized publishing-seat identity, not acoustic identity or evidence of hearing. */
export const captureEvidenceSpeakerSchema = z.strictObject({
  roundParticipantId: idSchema,
  actorId: idSchema,
  kind: z.enum(['human', 'bot']),
  role: z.enum(['affirmative', 'negative']),
  slot: z
    .number()
    .int()
    .min(0)
    .max(MAX_FORMAT_SEATS - 1),
});
export type CaptureEvidenceSpeaker = z.infer<
  typeof captureEvidenceSpeakerSchema
>;
