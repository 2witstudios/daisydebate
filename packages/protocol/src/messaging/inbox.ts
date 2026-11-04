import { z } from 'zod';
import { idSchema } from '../primitives';
import { messagingBetaLimits } from './core';
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
const cursorTime = z.iso.datetime();

/**
 * Where an inbox page ended: invitations lead, then newest activity first with
 * the channel as tie-break. It names only an entry its reader was already
 * scanned, and it is a position, never a navigation grant.
 */
export type MessagingInboxCursor =
  | { readonly kind: 'invitation'; readonly channelId: string }
  | { readonly kind: 'withheld'; readonly channelId: string }
  | {
      readonly kind: 'activity';
      readonly activityAt: string;
      readonly channelId: string;
    };

export const encodeMessagingInboxCursor = (
  cursor: MessagingInboxCursor,
): string =>
  `${cursor.kind === 'invitation' ? 'lead' : cursor.kind === 'withheld' ? 'withheld' : cursor.activityAt}~${cursor.channelId}`;

/** The cursor a page handed out, or null for anything else. */
export function decodeMessagingInboxCursor(
  value: string,
): MessagingInboxCursor | null {
  const [position, channel, ...rest] = value.split('~');
  if (position === undefined || channel === undefined || rest.length > 0)
    return null;
  const channelId = idSchema.safeParse(channel, { jitless: true });
  if (!channelId.success) return null;
  if (position === 'lead')
    return { kind: 'invitation', channelId: channelId.data };
  if (position === 'withheld')
    return { kind: 'withheld', channelId: channelId.data };
  const activityAt = cursorTime.safeParse(position, { jitless: true });
  return activityAt.success
    ? {
        kind: 'activity',
        activityAt: activityAt.data,
        channelId: channelId.data,
      }
    : null;
}

const inboxCursorSchema = z
  .string()
  .refine((value) => decodeMessagingInboxCursor(value) !== null);

/** One line, as a row shows it, so a search finds what its reader can see. */
export const messagingInboxSearchLine = (text: string): string =>
  text.replace(/\s+/g, ' ').trim();

/** Pagination bounds are the explicit owning policy, never a navigation grant. */
export function createMessagingInboxSchemas(maxItems: number) {
  z.number().int().positive().safe().parse(maxItems);
  return {
    query: z.strictObject({
      version: z.literal(1),
      after: inboxCursorSchema.optional(),
      /** A literal match on what a row shows; never message history. */
      q: z
        .string()
        .max(messagingBetaLimits.queryUnits)
        .refine((value) => messagingInboxSearchLine(value) !== '')
        .optional(),
    }),
    result: z.strictObject({
      version: z.literal(1),
      entries: z.array(messagingInboxEntrySchema).max(maxItems),
      nextAfter: inboxCursorSchema.nullable(),
    }),
    /** One conversation's own entry: who it is with, for its page (ISSUE-605). */
    entry: z.strictObject({
      version: z.literal(1),
      entry: messagingInboxEntrySchema,
    }),
  };
}
