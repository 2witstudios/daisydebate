import { z } from 'zod';
import { idSchema } from '../primitives';
import {
  observationBaseSchema,
  observationFrameBytes,
  observationHeaderSchema,
  observationJsonBytes,
  observationResourceKey,
} from '../observation';
import { createMessagingCoreSchemas, type MessagingCoreBounds } from './core';
import {
  messagingMessageRecordSchema,
  messagingMessageView,
} from './message-view';

/** Cumulative UTF-8 JSON budget for restricted projection rows; the remainder of a frame is envelope. */
export const observationProjectionRowBytes = 96 * 1024;
const order = z.number().int().positive().safe();
const maxSafe = Number.MAX_SAFE_INTEGER;
const worstId = 'z'.repeat(24);
const worstIso = '2026-10-12T00:00:00.000Z';
/** Every UTF-16 unit JSON-escapes to at most six bytes (`\u0001`). */
function assertRowBudget(messageUnits: number) {
  const worst = {
    id: worstId,
    channelId: worstId,
    authorActorId: worstId,
    sequence: maxSafe,
    changeVersion: maxSafe,
    text: '\u0001'.repeat(messageUnits),
    createdAt: worstIso,
    editedAt: worstIso,
    removedAt: worstIso,
    replyToMessageId: worstId,
  };
  const envelope = {
    v: 1,
    type: 'observation.snapshot',
    id: 'r'.repeat(128),
    generation: maxSafe,
    base: {
      schema: 1,
      resource: { kind: 'channel', id: worstId },
      partition: { kind: 'shared', policyKey: 'p'.repeat(100) },
      disclosureRevision: maxSafe,
      window: { after: maxSafe, limit: 50 },
    },
    contentRevision: maxSafe,
    purgeGeneration: maxSafe,
    body: { messages: [worst], continuation: maxSafe },
  };
  if (
    observationJsonBytes([worst]) > observationProjectionRowBytes ||
    observationJsonBytes(envelope) > observationFrameBytes
  )
    throw new RangeError('Message units exceed the observation row budget');
}
type ChannelProjection = {
  readonly base: unknown;
  readonly header: unknown;
  readonly rows: readonly unknown[];
  readonly continuation: number | string | null;
};
/** Rows belong to the base's channel, header and window; anything else is producer drift. */
function coherentRows(projection: ChannelProjection) {
  const base = observationBaseSchema.safeParse(projection.base);
  const header = observationHeaderSchema.safeParse(projection.header);
  if (
    !base.success ||
    !header.success ||
    base.data.resource.kind !== 'channel' ||
    observationResourceKey(header.data.resource) !==
      observationResourceKey(base.data.resource) ||
    header.data.disclosureRevision !== base.data.disclosureRevision ||
    projection.rows.length > base.data.window.limit ||
    observationJsonBytes(projection.rows) > observationProjectionRowBytes
  )
    return null;
  const rows = z.array(messagingMessageRecordSchema).safeParse(projection.rows);
  const { id } = base.data.resource,
    { after } = base.data.window;
  return rows.success &&
    rows.data.every(
      (row) =>
        row.channelId === id &&
        (typeof after !== 'number' || row.sequence < after),
    )
    ? rows.data
    : null;
}
/** Owning channel mapper shared by realtime builds and authorized HTTP reads.
 * Continuation is the last included sequence iff older history remains.
 */
export function createObservationChannelBody(bounds: MessagingCoreBounds) {
  assertRowBudget(bounds.messageUnits);
  const { message } = createMessagingCoreSchemas(bounds);
  const unavailable = z.strictObject({
    id: idSchema,
    channelId: idSchema,
    sequence: order,
    changeVersion: order,
    unavailable: z.literal(true),
  });
  const bodySchema = z
    .strictObject({
      messages: z.array(z.union([message, unavailable])).max(50),
      continuation: order.nullable(),
    })
    .refine(
      ({ messages, continuation }) =>
        messages.every(
          (item, index) =>
            index === 0 || messages[index - 1]!.sequence > item.sequence,
        ) &&
        (continuation === null || continuation === messages.at(-1)?.sequence),
    );
  return {
    bodySchema,
    fromProjection(projection: ChannelProjection) {
      const rows = coherentRows(projection);
      const body =
        rows &&
        bodySchema.safeParse({
          messages: rows.map(messagingMessageView),
          continuation: projection.continuation,
        });
      return body && body.success
        ? { status: 'ready' as const, body: body.data }
        : { status: 'unavailable' as const };
    },
  };
}
