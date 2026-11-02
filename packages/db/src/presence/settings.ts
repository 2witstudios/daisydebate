import { sql, eq, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { buildUserInboxTopic, type ChosenStatus } from '@daisy/protocol';
import { presenceSettings } from '../schema/presence';
import {
  readOwnCollection,
  requireOwnScope,
  type AuthorizationTransaction,
  type OwnCollectionFence,
} from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { appendOutboxEvent } from '../outbox';

/** The member whose own presence setting is read or written. */
type PresenceScope = {
  readonly userId: string;
  readonly actorId: string;
};

/**
 * Presence's published read for other features: the status the member named
 * by `actorId` (a column or value) chose. No row means online.
 */
export const chosenStatusOf = (actorId: SQL) =>
  sql<ChosenStatus>`coalesce((select ${presenceSettings.status} from ${presenceSettings} where ${presenceSettings.actorId} = ${actorId}), 'online')`;

const chosen = async (
  tx: Pick<BunSQLDatabase, 'select'>,
  actorId: string,
): Promise<ChosenStatus> => {
  const [row] = await tx
    .select({ status: presenceSettings.status })
    .from(presenceSettings)
    .where(eq(presenceSettings.actorId, actorId));
  return (row?.status as ChosenStatus | undefined) ?? 'online';
};

/** The status the member chose; no row means online. */
export function readChosenStatus(
  database: BunSQLDatabase,
  scope: PresenceScope,
  authorize: OwnCollectionFence<PresenceScope>,
): Promise<ChosenStatus> {
  requireOwnScope(scope);
  return readOwnCollection(database, scope, authorize, (tx) =>
    chosen(tx, scope.actorId),
  );
}

/**
 * Sets the member's own choice after `authorize` on their locked account. The
 * control row rings every realtime node (ADR 0098); it names only the member,
 * on their own inbox, and is never forwarded to a client.
 */
export function writeChosenStatus(
  database: BunSQLDatabase,
  scope: PresenceScope,
  input: { readonly status: ChosenStatus; readonly now: string },
  authorize: OwnCollectionFence<PresenceScope>,
): Promise<ChosenStatus> {
  requireOwnScope(scope);
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const values = { status: input.status, updatedAt: new Date(input.now) };
    await tx
      .insert(presenceSettings)
      .values({ actorId: scope.actorId, ...values })
      .onConflictDoUpdate({
        target: presenceSettings.actorId,
        set: values,
      });
    await appendOutboxEvent(tx as AuthorizationTransaction, {
      topic: buildUserInboxTopic(scope.actorId),
      kind: 'actor.presence-preference-changed',
      version: 1,
      payload: {
        entityVersion: 1,
        kind: 'actor.presence-preference-changed',
        ids: [scope.actorId],
      },
    });
    return input.status;
  });
}

/** The member's own chosen status (ADR 0098), instrumented. */
export const presenceSettingOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readChosenStatus: (
    scope: PresenceScope,
    authorize: OwnCollectionFence<PresenceScope>,
  ) =>
    instrumented(eventSink, 'readChosenStatus', () =>
      readChosenStatus(database, scope, authorize),
    ),
  writeChosenStatus: (
    scope: PresenceScope,
    input: { readonly status: ChosenStatus; readonly now: string },
    authorize: OwnCollectionFence<PresenceScope>,
  ) =>
    instrumented(eventSink, 'writeChosenStatus', () =>
      writeChosenStatus(database, scope, input, authorize),
    ),
});
