import { z } from 'zod';
import { idSchema } from '../primitives';

/** Transport bounds are injected by the owning policy; no product defaults. */
export type MessagingCoreBounds = Readonly<{
  messageUnits: number;
  pageItems: number;
}>;

export function messagingTextSchema(maxUnits: number) {
  z.number().int().positive().safe().parse(maxUnits);
  return z
    .string()
    .refine((text) => text.length <= maxUnits)
    .refine((text) => text.trim().length > 0);
}

const orderingNumber = z.number().int().nonnegative().safe();
const sequenceCursor = z.strictObject({
  channelId: idSchema,
  sequence: orderingNumber.refine((sequence) => sequence > 0),
});
const changeCursor = z.strictObject({
  channelId: idSchema,
  changeVersion: orderingNumber,
});
const mutation = {
  version: z.literal(1),
  channelId: idSchema,
  requestId: idSchema,
};

/** Validation proves shape only. Operations recheck current authorization. */
export function createMessagingCoreSchemas(bounds: MessagingCoreBounds) {
  z.number().int().positive().safe().parse(bounds.pageItems);
  const text = messagingTextSchema(bounds.messageUnits);
  const positiveOrder = orderingNumber.refine((value) => value > 0);
  const message = z.strictObject({
    id: idSchema,
    channelId: idSchema,
    authorActorId: idSchema,
    sequence: positiveOrder,
    changeVersion: positiveOrder,
    text,
    createdAt: z.iso.datetime(),
    editedAt: z.iso.datetime().nullable(),
    replyToMessageId: idSchema.optional(),
  });
  const unavailableMessage = z.strictObject({
    id: idSchema,
    channelId: idSchema,
    sequence: positiveOrder,
    changeVersion: positiveOrder,
    unavailable: z.literal(true),
  });
  const changedMessage = z
    .strictObject({
      kind: z.enum(['created', 'edited']),
      channelId: idSchema,
      messageId: idSchema,
      changeVersion: positiveOrder,
      message,
    })
    .refine(
      (change) =>
        change.message.id === change.messageId &&
        change.message.channelId === change.channelId &&
        change.message.changeVersion === change.changeVersion,
    );
  const removedMessage = z.strictObject({
    kind: z.literal('removed'),
    channelId: idSchema,
    messageId: idSchema,
    changeVersion: positiveOrder,
  });
  const page = {
    version: z.literal(1),
    channelId: idSchema,
    limit: z.number().int().min(1).max(bounds.pageItems),
  };
  return {
    message,
    historyResult: z
      .strictObject({
        version: z.literal(1),
        channelId: idSchema,
        changeVersion: orderingNumber,
        messages: z
          .array(z.union([message, unavailableMessage]))
          .max(bounds.pageItems),
        nextBefore: sequenceCursor.nullable(),
      })
      .refine(
        (result) =>
          result.messages.every(
            (item, index) =>
              item.channelId === result.channelId &&
              item.changeVersion <= result.changeVersion &&
              (index === 0 ||
                result.messages[index - 1]!.sequence > item.sequence),
          ) &&
          (result.nextBefore === null ||
            (result.nextBefore.channelId === result.channelId &&
              result.nextBefore.sequence === result.messages.at(-1)?.sequence)),
      ),
    changesResult: z
      .strictObject({
        version: z.literal(1),
        channelId: idSchema,
        changeVersion: orderingNumber,
        changes: z
          .array(z.union([changedMessage, removedMessage]))
          .max(bounds.pageItems),
        nextAfter: changeCursor,
      })
      .refine(
        (result) =>
          result.changes.every(
            (item, index) =>
              item.channelId === result.channelId &&
              item.changeVersion <= result.changeVersion &&
              (index === 0 ||
                result.changes[index - 1]!.changeVersion < item.changeVersion),
          ) &&
          result.nextAfter.channelId === result.channelId &&
          result.nextAfter.changeVersion <= result.changeVersion &&
          (result.changes.length === 0 ||
            result.nextAfter.changeVersion === result.changeVersion ||
            result.nextAfter.changeVersion ===
              result.changes.at(-1)?.changeVersion),
      ),
    send: z.strictObject({
      ...mutation,
      text,
      replyToMessageId: idSchema.optional(),
    }),
    edit: z.strictObject({ ...mutation, messageId: idSchema, text }),
    remove: z.strictObject({ ...mutation, messageId: idSchema }),
    history: z
      .strictObject({ ...page, before: sequenceCursor.optional() })
      .refine(
        (input) =>
          input.before === undefined ||
          input.before.channelId === input.channelId,
      ),
    search: z
      .strictObject({ ...page, query: text, before: sequenceCursor.optional() })
      .refine(
        (input) =>
          input.before === undefined ||
          input.before.channelId === input.channelId,
      ),
    changes: z
      .strictObject({ ...page, after: changeCursor })
      .refine((input) => input.after.channelId === input.channelId),
    markRead: z
      .strictObject({
        version: z.literal(1),
        channelId: idSchema,
        cursor: sequenceCursor,
      })
      .refine((input) => input.cursor.channelId === input.channelId),
  };
}
