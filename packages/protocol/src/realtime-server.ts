import { z } from 'zod';
import {
  ENVELOPE_VERSION,
  cursorSchema,
  realtimeRequestIdSchema,
} from './realtime';
import { parseTopic, topicStringSchema } from './topics';
import {
  outboxPayloadSchema,
  isPayloadDeliverableOnTopic,
} from './realtime-payloads';

const envelope = { v: z.literal(ENVELOPE_VERSION) };
// Existing browser heartbeat IDs are correlation strings, not entity IDs.
const requestId = realtimeRequestIdSchema;
const subscription = { ...envelope, id: requestId, topic: topicStringSchema };
const eventSchema = z
  .strictObject({
    ...envelope,
    type: z.literal('event'),
    topic: topicStringSchema,
    position: cursorSchema,
    payload: outboxPayloadSchema,
  })
  .refine(({ topic, payload }) => isPayloadDeliverableOnTopic(topic, payload), {
    message: 'Payload is not deliverable on topic',
  });

/** Portable framing only. HTTP remains the authority for commands and reads. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('ready') }),
  z.strictObject({ ...envelope, type: z.literal('pong'), id: requestId }),
  z.strictObject({
    ...subscription,
    type: z.literal('subscribed'),
    position: cursorSchema,
  }),
  z.strictObject({ ...subscription, type: z.literal('unsubscribed') }),
  z.strictObject({ ...subscription, type: z.literal('resync_required') }),
  z.strictObject({
    ...envelope,
    type: z.literal('error'),
    id: requestId.optional(),
    code: z.enum([
      'VALIDATION',
      'AUTHORIZATION',
      'RATE_LIMIT',
      'INFRASTRUCTURE',
    ]),
    message: z.string().max(256),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('typing_changed'),
    topic: topicStringSchema.refine(
      (topic) => parseTopic(topic)?.family === 'channel',
      { message: 'Typing hints require a channel topic' },
    ),
  }),
  eventSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
