import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { buildUserInboxTopic } from '@daisy/protocol';
import { appendOutboxEvent } from './outbox';
import { queryActorByUserId } from './actor-operations';
import type { DatabaseEventSink } from './instrumented';

type Tx = Pick<BunSQLDatabase, 'select' | 'execute' | 'insert'>;

/**
 * The one `session.revoked` outbox append (ISSUE-8 AC2), run inside the
 * caller's transaction. Plan revision 4.10: resolves the actor through
 * `actors.user_id`, never `userId` directly; a user with no actor row (never
 * claimed a username) appends nothing and reports
 * `realtime.outbox.actor_missing` instead of throwing. Was copied twice
 * (`appendSessionRevoked` and `revokeOtherSessions`); both now call this.
 */
export async function appendSessionRevokedFor(
  tx: Tx,
  userId: string,
  eventSink: DatabaseEventSink | undefined,
  operation: string,
): Promise<void> {
  const actor = await queryActorByUserId(tx, userId);
  if (!actor) {
    eventSink?.(
      'realtime.outbox.actor_missing',
      { operation },
      'No actor row for this user (never claimed a username); revocation outbox row not appended',
    );
    return;
  }
  await appendOutboxEvent(tx, {
    topic: buildUserInboxTopic(actor.id),
    kind: 'session.revoked',
    version: 1,
    payload: { entityVersion: 1, kind: 'session.revoked', ids: [actor.id] },
  });
}
