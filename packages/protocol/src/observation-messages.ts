import { z } from 'zod';
import { ENVELOPE_VERSION, realtimeRequestIdSchema } from './realtime';
import {
  observationResourceSchema,
  observationBaseSchema,
  observationFrameBytes,
  createObservationClientMessageSchema,
} from './observation';
const envelope = {
  v: z.literal(ENVELOPE_VERSION),
  id: realtimeRequestIdSchema,
};
const generation = z.number().int().nonnegative().safe();
const revision = z.number().int().nonnegative().safe();
export const observationClientMessageSchema =
  createObservationClientMessageSchema(ENVELOPE_VERSION);
export const observationServerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('observation.ready'),
    generation,
    base: observationBaseSchema,
    minimumContentRevision: revision,
    validForMs: z.number().int().min(1).max(4900),
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
    .refine((frame) => frameByteLength(frame) <= observationFrameBytes, {
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
export type ObservationClientMessage = z.infer<
  typeof observationClientMessageSchema
>;
export type ObservationServerMessage = z.infer<
  typeof observationServerMessageSchema
>;

function frameByteLength(frame: unknown) {
  let bytes = 0;
  for (const char of JSON.stringify(frame)) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
