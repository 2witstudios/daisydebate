import { eq, sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { presenceSettings } from '../schema/presence';
import {
  readOwnCollection,
  requireOwnScope,
  type OwnCollectionFence,
} from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';

/** The member whose own presence setting is read or written. */
type PresenceScope = {
  readonly userId: string;
  readonly actorId: string;
};

/**
 * Presence's published read for other features: whether the member named by
 * `actorId` (a column or value) hides their online status. No row means
 * visible.
 */
export const presenceHiddenOf = (actorId: SQL) =>
  sql<boolean>`coalesce((select ${presenceSettings.hidden} from ${presenceSettings} where ${presenceSettings.actorId} = ${actorId}), false)`;

/** Whether the member hides their online status; no row means visible. */
export function readPresenceHidden(
  database: BunSQLDatabase,
  scope: PresenceScope,
  authorize: OwnCollectionFence<PresenceScope>,
): Promise<boolean> {
  requireOwnScope(scope);
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const [row] = await tx
      .select({ hidden: presenceSettings.hidden })
      .from(presenceSettings)
      .where(eq(presenceSettings.actorId, scope.actorId));
    return row?.hidden ?? false;
  });
}

/** Sets the member's own choice, after `authorize` on their locked account. */
export function writePresenceHidden(
  database: BunSQLDatabase,
  scope: PresenceScope,
  input: { readonly hidden: boolean; readonly now: string },
  authorize: OwnCollectionFence<PresenceScope>,
): Promise<boolean> {
  requireOwnScope(scope);
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const values = { hidden: input.hidden, updatedAt: new Date(input.now) };
    await tx
      .insert(presenceSettings)
      .values({ actorId: scope.actorId, ...values })
      .onConflictDoUpdate({
        target: presenceSettings.actorId,
        set: values,
      });
    return input.hidden;
  });
}

/** The member's own presence visibility (ADR 0072), instrumented. */
export const presenceSettingOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readPresenceHidden: (
    scope: PresenceScope,
    authorize: OwnCollectionFence<PresenceScope>,
  ) =>
    instrumented(eventSink, 'readPresenceHidden', () =>
      readPresenceHidden(database, scope, authorize),
    ),
  writePresenceHidden: (
    scope: PresenceScope,
    input: { readonly hidden: boolean; readonly now: string },
    authorize: OwnCollectionFence<PresenceScope>,
  ) =>
    instrumented(eventSink, 'writePresenceHidden', () =>
      writePresenceHidden(database, scope, input, authorize),
    ),
});
