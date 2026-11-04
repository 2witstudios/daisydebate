import { z } from 'zod';
import { idSchema } from '../primitives';

/**
 * DEC-124 (confirmed 2026-10-26): the beta size policy. Text counts UTF-16
 * code units, so a supplementary character takes two; oversized input is
 * refused, never truncated. Injected bounds may be tighter, never looser.
 */
export const messagingBetaLimits = {
  messageUnits: 4000,
  introductionUnits: 500,
  titleUnits: 80,
  queryUnits: 200,
  pageItems: 100,
  batchActors: 50,
  bodyBytes: 65536,
} as const;

/** The stored reaction column's bound; older values outside today's choices remain. */
export const messagingReactionMaxUnits = 8;

/** Refuses an injected bound that is not a positive integer within its beta limit. */
export const parseMessagingBound = (value: number, limit: number) =>
  z.number().int().positive().max(limit).parse(value);

/** Transport bounds are injected by the owning policy within the beta limits. */
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
  parseMessagingBound(bounds.pageItems, messagingBetaLimits.pageItems);
  const text = messagingTextSchema(
    parseMessagingBound(bounds.messageUnits, messagingBetaLimits.messageUnits),
  );
  const query = messagingTextSchema(
    Math.min(bounds.messageUnits, messagingBetaLimits.queryUnits),
  );
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
  /** Shared counts only: who reacted never enters a shared body (ADR 0115). */
  const reactionCount = z.strictObject({
    reaction: z.string().min(1).max(messagingReactionMaxUnits),
    count: z.number().int().positive().safe(),
  });
  const historyMessage = z.strictObject({
    ...message.shape,
    reactions: z.array(reactionCount),
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
  const historyPage = {
    version: z.literal(1),
    channelId: idSchema,
    changeVersion: orderingNumber,
    messages: z
      .array(z.union([historyMessage, unavailableMessage]))
      .max(bounds.pageItems),
    nextBefore: sequenceCursor.nullable(),
  };
  const coherentHistory = (result: {
    readonly channelId: string;
    readonly changeVersion: number;
    readonly messages: readonly {
      readonly channelId: string;
      readonly changeVersion: number;
      readonly sequence: number;
    }[];
    readonly nextBefore: {
      readonly channelId: string;
      readonly sequence: number;
    } | null;
  }) =>
    result.messages.every(
      (item, index) =>
        item.channelId === result.channelId &&
        item.changeVersion <= result.changeVersion &&
        (index === 0 || result.messages[index - 1]!.sequence > item.sequence),
    ) &&
    (result.nextBefore === null ||
      (result.nextBefore.channelId === result.channelId &&
        result.nextBefore.sequence === result.messages.at(-1)?.sequence));
  return {
    message,
    /** Every member's view of a page: the only shape a shared body carries. */
    historyResult: z.strictObject(historyPage).refine(coherentHistory),
    /** An authorized HTTP read: the same page plus this reader's own state. */
    viewedHistoryResult: z
      .strictObject({
        ...historyPage,
        viewer: z.strictObject({
          readSequence: orderingNumber,
          /** The first live message from someone else past the read position. */
          firstUnreadSequence: positiveOrder.nullable(),
          ownReactions: z.array(
            z.strictObject({
              messageId: idSchema,
              reactions: z.array(reactionCount.shape.reaction).min(1),
            }),
          ),
        }),
      })
      .refine(coherentHistory),
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
      .strictObject({ ...page, query, before: sequenceCursor.optional() })
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
