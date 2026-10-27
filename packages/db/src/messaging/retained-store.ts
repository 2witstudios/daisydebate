import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  readOwnCollection,
  type AuthorizationTransaction,
  type OwnCollectionFence,
} from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { eraseRetainedAuthorship, requireRetainedAuthor } from './retained-dm';

type Scope = { readonly actorId: string; readonly userId: string };
const rowsOf = <T>(rows: unknown) => rows as T[];
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);

/**
 * A survivor's retained conversations (DEC-126): only their own live rows
 * count, so the last activity and size are theirs alone; there is no
 * unread state, sequence or counterpart.
 */
async function listRetained(
  tx: Pick<BunSQLDatabase, 'execute'>,
  actorId: string,
) {
  return rowsOf<{ channelId: string; messages: number; lastAt: unknown }>(
    await tx.execute(sql`
    select r.channel_id as "channelId", count(m.id)::int as "messages", max(m.created_at) as "lastAt"
    from messaging_retained_authors r
    join messaging_channels c on c.id=r.channel_id and c.lifecycle='retained'
    join messaging_messages m on m.channel_id=r.channel_id and m.author_actor_id=r.actor_id and m.removed_at is null
    where r.actor_id=${actorId}
    group by r.channel_id order by max(m.created_at) desc, r.channel_id
  `),
  ).map((row) => ({ ...row, lastAt: iso(row.lastAt) }));
}

/** The survivor's own live messages in one retained conversation, oldest first. */
async function readRetained(
  tx: AuthorizationTransaction,
  actorId: string,
  channelId: string,
) {
  await requireRetainedAuthor(tx, actorId, channelId);
  return rowsOf<{
    id: string;
    text: string;
    createdAt: unknown;
    editedAt: unknown;
  }>(
    await tx.execute(sql`
    select id, text, created_at as "createdAt", edited_at as "editedAt"
    from messaging_messages
    where channel_id=${channelId} and author_actor_id=${actorId} and removed_at is null
    order by sequence
  `),
  ).map((row) => ({
    id: row.id,
    text: row.text,
    createdAt: iso(row.createdAt),
    editedAt: row.editedAt === null ? null : iso(row.editedAt),
  }));
}

/** Survivor-only operations over retained DMs, each fenced on the caller's own account. */
export const retainedConversationOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
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
        await tx.execute(
          sql`select id from messaging_channels where id=${scope.channelId} for update`,
        );
        await eraseRetainedAuthorship(tx, scope.actorId, [scope.channelId]);
      }),
    ),
});
