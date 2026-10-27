import { z } from 'zod';
import { idSchema } from '../primitives';
/** Display bounds: a preview is a truncated excerpt, never the full message. */
export const messagingInboxPreviewMax = 120;
export const messagingInboxTitleMax = 200;
/**
 * A summarized entry carries what its own grant already shows: the
 * counterpart's public username or the group title, and a truncated excerpt
 * of the newest message or request introduction. A pending invitation stays
 * minimal: the invitee sees nothing of the group before accepting.
 */
const messagingInboxEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    channelId: idSchema,
    kind: z.enum([
      'conversation',
      'group_conversation',
      'incoming_request',
      'outgoing_request',
    ]),
    title: z.string().min(1).max(messagingInboxTitleMax).nullable(),
    preview: z
      .strictObject({
        text: z.string().min(1).max(messagingInboxPreviewMax),
        fromSelf: z.boolean(),
      })
      .nullable(),
    activityAt: z.iso.datetime(),
    unread: z.boolean(),
  }),
  z.strictObject({
    channelId: idSchema,
    kind: z.literal('incoming_invitation'),
  }),
]);
/** Pagination bounds are the explicit owning policy, never a navigation grant. */
export function createMessagingInboxSchemas(maxItems: number) {
  z.number().int().positive().safe().parse(maxItems);
  return {
    query: z.strictObject({
      version: z.literal(1),
      after: idSchema.optional(),
    }),
    result: z.strictObject({
      version: z.literal(1),
      entries: z.array(messagingInboxEntrySchema).max(maxItems),
      nextAfter: idSchema.nullable(),
    }),
    /** One conversation's own entry: who it is with, for its page (ISSUE-605). */
    entry: z.strictObject({
      version: z.literal(1),
      entry: messagingInboxEntrySchema,
    }),
  };
}
