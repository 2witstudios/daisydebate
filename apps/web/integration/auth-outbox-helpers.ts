import { createId } from '@paralleldrive/cuid2';
import { buildUserInboxTopic } from '@daisy/protocol';
import { withSql } from './auth-mounted-helpers';

/**
 * RT-2.2: shared fixtures for suites that assert an auth operation appends a
 * `session.revoked` outbox row for the acting user's actor.
 *
 * Plan revision 4.10: the outbox append only runs once the actor resolves
 * through `actors.user_id`. ACTOR-1 creates that row during real username
 * onboarding, but these suites sign up without ever claiming a username (an
 * unrelated surface to session revocation/email-change), so `createActorFor`
 * inserts the actor directly rather than going through the onboarding route.
 * Revocation rows are keyed by `actors.id`, never `userId`.
 */
export const createActorFor = async (userId: string): Promise<string> => {
  const actorId = createId();
  await withSql(
    (sql) =>
      sql`INSERT INTO actors (id, kind, user_id) VALUES (${actorId}, 'human', ${userId})`,
  );
  return actorId;
};

export const cleanupActorFor = (userId: string) =>
  withSql((sql) => sql`DELETE FROM actors WHERE user_id = ${userId}`);

/** Outbox rows a `session.revoked`-emitting operation appended for this actor. */
export const sessionRevokedEvents = (actorId: string) =>
  withSql(
    (sql) =>
      sql`SELECT topic FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
  ).then((rows) => rows.length);

export const cleanupOutboxFor = (actorId: string) =>
  withSql(
    (sql) =>
      sql`DELETE FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
  );
