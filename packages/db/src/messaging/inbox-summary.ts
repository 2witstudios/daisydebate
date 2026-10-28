import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { AuthorizationTransaction } from '../authorization';

export type MessagingInboxSummary = {
  readonly title: string | null;
  readonly lastMessage: {
    readonly text: string;
    readonly fromSelf: boolean;
    readonly createdAt: string;
  } | null;
  readonly introduction: {
    readonly text: string | null;
    readonly fromSelf: boolean;
    readonly requestedAt: string;
  } | null;
  readonly createdAt: string;
  readonly unread: boolean;
};

const timestamp = z.iso.datetime();
const rowSchema = z.object({
  channelId: idSchema,
  title: z.string().nullable(),
  counterpart: z.string().nullable(),
  createdAt: timestamp,
  lastText: z.string().nullable(),
  lastAuthor: z.string().nullable(),
  lastAt: timestamp.nullable(),
  unread: z.boolean(),
  introduction: z.string().nullable(),
  requestSender: z.string().nullable(),
  requestedAt: timestamp.nullable(),
});
const iso = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

type SummaryInput = {
  readonly channelId: string;
  readonly actorId: string;
  readonly counterpartActorId: string | null;
  readonly content: 'messages' | 'introduction';
};
type SummaryRow = z.infer<typeof rowSchema>;

const validInput = (input: SummaryInput) =>
  [input.channelId, input.actorId, input.counterpartActorId ?? input.actorId]
    .map((id) => idSchema.safeParse(id).success)
    .every(Boolean);

function requestSummary(
  found: SummaryRow,
  actorId: string,
  title: string | null,
): MessagingInboxSummary | null {
  if (found.requestSender === null || found.requestedAt === null) return null;
  const fromSelf = found.requestSender === actorId;
  return {
    title,
    lastMessage: null,
    introduction: {
      text: found.introduction,
      fromSelf,
      requestedAt: found.requestedAt,
    },
    createdAt: found.createdAt,
    unread: !fromSelf,
  };
}

function conversationSummary(
  found: SummaryRow,
  actorId: string,
  title: string | null,
): MessagingInboxSummary {
  return {
    title,
    lastMessage:
      found.lastText === null || found.lastAt === null
        ? null
        : {
            text: found.lastText,
            fromSelf: found.lastAuthor === actorId,
            createdAt: found.lastAt,
          },
    introduction: null,
    createdAt: found.createdAt,
    unread: found.unread,
  };
}

/**
 * Runs inside the caller's already-fenced channel frame. `content` selects
 * message history (an approved conversation) or the pending request
 * introduction; never both, so a request never exposes history.
 */
export async function readMessagingInboxSummary(
  tx: AuthorizationTransaction,
  input: SummaryInput,
): Promise<MessagingInboxSummary> {
  const [summary] = await readMessagingInboxSummaries(tx, input.actorId, [
    input,
  ]);
  if (!summary) throw createAppError('NOT_FOUND');
  return summary;
}

/**
 * The same summaries for many channels of one reader in one statement, in
 * input order; a channel or request that vanished is null at its index.
 */
export async function readMessagingInboxSummaries(
  tx: AuthorizationTransaction,
  actorId: string,
  inputs: readonly Omit<SummaryInput, 'actorId'>[],
): Promise<readonly (MessagingInboxSummary | null)[]> {
  if (!inputs.every((input) => validInput({ ...input, actorId })))
    throw createAppError('VALIDATION');
  if (inputs.length === 0) return [];
  const wanted = inputs.map((input) => ({
    channel_id: input.channelId,
    counterpart: input.counterpartActorId,
    messages: input.content === 'messages',
  }));
  const rows = await tx.execute(sql`
    select c.id as "channelId", c.title as "title",
      (select u.username from public.actors a join public.users u on u.id = a.user_id
        where a.id = w.counterpart and u.deleted_at is null) as "counterpart",
      ${iso('c.created_at')} as "createdAt",
      last.text as "lastText", last.author_actor_id as "lastAuthor",
      ${iso('last.created_at')} as "lastAt",
      (w.messages and exists (select 1 from public.messaging_messages m
        where m.channel_id = c.id and m.author_actor_id <> ${actorId}
        and m.removed_at is null and m.sequence > coalesce((select s.read_sequence
          from public.messaging_actor_states s
          where s.channel_id = c.id and s.actor_id = ${actorId}), 0))) as "unread",
      case when w.messages then null else p.introduction end as "introduction",
      case when w.messages then null else p.request_sender_actor_id end as "requestSender",
      case when w.messages then null else ${iso('p.requested_at')} end as "requestedAt"
    from jsonb_to_recordset(${JSON.stringify(wanted)}::text::jsonb)
      as w(channel_id text, counterpart text, messages boolean)
    join public.messaging_channels c on c.id = w.channel_id
    left join public.messaging_dm_pairs p on p.channel_id = c.id
    left join lateral (select m.text, m.author_actor_id, m.created_at
      from public.messaging_messages m
      where w.messages and m.channel_id = c.id and m.removed_at is null
      order by m.sequence desc limit 1) last on true
  `);
  const found = new Map<string, SummaryRow>();
  for (const raw of rows) {
    const row = rowSchema.safeParse(raw);
    if (!row.success) throw createAppError('INFRASTRUCTURE');
    found.set(row.data.channelId, row.data);
  }
  return inputs.map((input) => {
    const row = found.get(input.channelId);
    if (!row) return null;
    const title =
      input.counterpartActorId === null ? row.title : row.counterpart;
    return input.content === 'messages'
      ? conversationSummary(row, actorId, title)
      : requestSummary(row, actorId, title);
  });
}
