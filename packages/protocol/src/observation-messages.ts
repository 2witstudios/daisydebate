import { z } from 'zod';
import { ENVELOPE_VERSION, realtimeRequestIdSchema } from './realtime';
import {
  observationResourceSchema,
  observationBaseSchema,
  observationFrameBytes,
  observationJsonBytes,
  observationOverlayBytes,
} from './observation';
const envelope = {
  v: z.literal(ENVELOPE_VERSION),
  id: realtimeRequestIdSchema,
};
const generation = z.number().int().nonnegative().safe();
const revision = z.number().int().nonnegative().safe();
/** Small actor-private facts from the same canonical admission read. */
export const observationOverlaySchema = z
  .json()
  .refine((value) => observationJsonBytes(value) <= observationOverlayBytes, {
    message: 'Observation overlay exceeds byte bound',
  });
export type ObservationOverlay = z.infer<typeof observationOverlaySchema>;
export const observationServerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('observation.ready'),
    generation,
    base: observationBaseSchema,
    minimumContentRevision: revision,
    validForMs: z.number().int().min(1).max(4900),
    /** Present only when the overlay changed for this request generation. */
    overlay: observationOverlaySchema.optional(),
  }),
  z
    .strictObject({
      ...envelope,
      type: z.literal('observation.snapshot'),
      generation,
      base: observationBaseSchema,
      contentRevision: revision,
      purgeGeneration: revision,
      body: z.json(),
    })
    .refine((frame) => observationJsonBytes(frame) <= observationFrameBytes, {
      message: 'Observation frame exceeds byte bound',
    }),
  z.strictObject({
    ...envelope,
    type: z.literal('observation.state'),
    generation,
    resource: observationResourceSchema,
    state: z.enum(['denied', 'unavailable', 'degraded']),
  }),
]);
export type ObservationServerMessage = z.infer<
  typeof observationServerMessageSchema
>;
