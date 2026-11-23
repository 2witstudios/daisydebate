import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  supportMessageLimits,
  supportTopics,
} from '@daisy/protocol/support-message';
import { mailJobChecks, mailJobColumns, oneOf } from './columns';
import { users } from './users';

export const supportMessageNoticeErrorCodes = [
  'delivery',
  'delivery-unknown',
  'suppressed',
  'not-owed',
  /** The stored message could not be read on the last attempt: a data fault, not the provider. */
  'unreadable',
] as const;

/**
 * Support messages (SUPP-1): anyone, signed in or not, asks for help or
 * gives feedback from /support. The row is the message and its one owner
 * notice: the mail job columns carry that email's delivery, which the web
 * mail worker sends to the configured owner address, reading the message
 * fresh at send time. A stored message never changes: its id is an
 * identifier, not an edit credential (ADR 0018). It holds the sender's
 * personal data and is deleted 365 days after it was sent, or when the
 * signed-in sender's account is erased (compliance: support messages).
 */
export const supportMessages = pgTable(
  'support_messages',
  {
    id: text('id').primaryKey(),
    /** The id the sent form carried; its first version is stored under it. */
    formId: text('form_id').notNull(),
    /** SHA3-256 of the message's fields: one row per version of a form. */
    fieldsDigest: text('fields_digest').notNull(),
    topic: text('topic').$type<(typeof supportTopics)[number]>().notNull(),
    message: text('message').notNull(),
    /** What page or round it is about, in the sender's words; null when not given. */
    about: text('about'),
    replyEmail: text('reply_email').notNull(),
    /** The account signed in when it was sent; null for a visitor. */
    memberUserId: text('member_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...mailJobColumns<typeof supportMessageNoticeErrorCodes>(),
  },
  (table) => [
    check('support_messages_topic_check', oneOf(table.topic, supportTopics)),
    check(
      'support_messages_text_check',
      sql`char_length(${table.message}) between 1 and ${sql.raw(String(supportMessageLimits.message))}
        and (${table.about} is null or char_length(${table.about}) between 1 and ${sql.raw(String(supportMessageLimits.about))})
        and char_length(${table.replyEmail}) between 3 and ${sql.raw(String(supportMessageLimits.replyEmail))}`,
    ),
    ...mailJobChecks('support_messages', table, supportMessageNoticeErrorCodes),
    uniqueIndex('support_messages_version_idx').on(
      table.formId,
      table.fieldsDigest,
    ),
    check(
      'support_messages_digest_check',
      sql`${table.fieldsDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    index('support_messages_due_idx').on(table.state, table.nextAttemptAt),
    index('support_messages_created_idx').on(table.createdAt),
    index('support_messages_member_idx').on(table.memberUserId),
  ],
);
