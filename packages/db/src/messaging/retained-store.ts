import { sql } from 'drizzle-orm';
import { readOwnCollection, type OwnCollectionFence } from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { eraseRetainedAuthorship, requireRetainedAuthor } from './retained-dm';
import type { Tx, TxSource } from '../tx';
import { query, run } from '../raw-rows';
import { z } from 'zod';

type Scope = { readonly actorId: string; readonly userId: string };
const timestamp = z.date();

/**
 * A survivor's retained conversations (DEC-126): only their own live rows
 * count, so the last activity and size are theirs alone; there is no
 * unread state, sequence or counterpart.
 */
async function listRetained(tx: Tx, actorId: string) {
  const rows = await query(
    tx,
    z.object({ channelId: z.string(), messages: z.int(), lastAt: timestamp }),
    sql`
    select r.channel_id as "channelId", count(m.id)::int as "messages", max(m.created_at) as "lastAt"
    from messaging_retained_authors r
    join messaging_channels c on c.id=r.channel_id and c.lifecycle='retained'
    join messaging_messages m on m.channel_id=r.channel_id and m.author_actor_id=r.actor_id and m.removed_at is null
    where r.actor_id=${actorId}
    group by r.channel_id order by max(m.created_at) desc, r.channel_id
  `,
  );
  return rows.map((row) => ({ ...row, lastAt: row.lastAt.toISOString() }));
}

/** The survivor's own live messages in one retained conversation, oldest first. */
async function readRetained(tx: Tx, actorId: string, channelId: string) {
  await requireRetainedAuthor(tx, actorId, channelId);
  const rows = await query(
    tx,
    z.object({
      id: z.string(),
      text: z.string(),
      createdAt: timestamp,
      editedAt: timestamp.nullable(),
    }),
    sql`
    select id, text, created_at as "createdAt", edited_at as "editedAt"
    from messaging_messages
    where channel_id=${channelId} and author_actor_id=${actorId} and removed_at is null
    order by sequence
  `,
  );
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  }));
}

/** Survivor-only operations over retained DMs, each fenced on the caller's own account. */
export const retainedConversationOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  listRetainedConversations: (
    scope: Scope,
    authorize: OwnCollectionFence<Scope>,
  ) =>
    instrumented(eventSink, 'listRetainedConversations', () =>
      readOwnCollection(database, scope, authorize, (tx) =>
        listRetained(tx, scope.actorId),
      ),
    ),
  readRetainedConversation: (
    scope: Scope & { readonly channelId: string },
    authorize: OwnCollectionFence<Scope>,
  ) =>
    instrumented(eventSink, 'readRetainedConversation', () =>
      readOwnCollection(database, scope, authorize, (tx) =>
        readRetained(tx, scope.actorId, scope.channelId),
      ),
    ),
  /**
   * "Delete this conversation": the survivor's rows and files (through file
   * intents) and their grant; the channel goes with its last survivor.
   */
  deleteRetainedConversation: (
    scope: Scope & { readonly channelId: string },
    authorize: OwnCollectionFence<Scope>,
  ) =>
    instrumented(eventSink, 'deleteRetainedConversation', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        await requireRetainedAuthor(tx, scope.actorId, scope.channelId);
        await run(
          tx,
          sql`select id from messaging_channels where id=${scope.channelId} for update`,
        );
        await eraseRetainedAuthorship(tx, scope.actorId, [scope.channelId]);
      }),
    ),
});
