import {
  loadTournamentCaptureFunding,
  type TournamentCaptureFunderLocator,
} from './tournament-capture-funding';
import { fixtureConnections } from './fixture-conflict';
import { and, eq } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { fixtures } from '../schema/fixtures';
import { rooms } from '../schema/rooms';
import { scopeTransaction } from '../tenant-scope';
import { loadAuthorityContext } from './authority-context';
import { lockEventSettingContext } from './event-setting-context';
import type { TabTransaction } from './tab-transaction';

/**
 * Tab's read-only input to ordinary Room direction. A snapshot prepares an
 * external consent read; only the reloaded, account-before-parent locked
 * input can authorize a command or replay. No Room host or cast is invented.
 */
export const loadRoomDirection = async (
  tx: TabTransaction,
  input: {
    readonly room: Pick<
      typeof rooms.$inferSelect,
      'id' | 'lobbyId' | 'hostActorId'
    >;
    readonly userId: string;
    readonly snapshot?: boolean;
    readonly captureFunder?: TournamentCaptureFunderLocator | null;
  },
) => {
  if (input.room.hostActorId !== null) return null;
  await scopeTransaction(tx, {
    subjectUserId: input.userId,
    lobbyId: input.room.lobbyId,
  });
  const [found] = await tx
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.roomId, input.room.id),
        eq(fixtures.lobbyId, input.room.lobbyId),
        eq(fixtures.status, 'published'),
      ),
    );
  if (!found) return null;
  const configuration = await lockEventSettingContext(tx, {
    lobbyId: found.lobbyId,
    eventId: found.eventId,
    subjectUserId: input.userId,
    strength: 'share',
    ...(input.snapshot ? { snapshot: true } : {}),
  });
  if (
    !configuration ||
    configuration.lobby.kind !== 'tournament' ||
    configuration.lobby.closedAt !== null
  )
    return null;
  const query = tx
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.id, found.id),
        eq(fixtures.roomId, input.room.id),
        eq(fixtures.status, 'published'),
      ),
    );
  const [fixture] = await (input.snapshot ? query : query.for('share'));
  if (!fixture) return null;
  const authorization = await loadAuthorityContext(
    tx,
    configuration.scope,
    input.userId,
    input.snapshot ? null : 'share',
  );
  const [owner] = configuration.lobby.ownerUserId
    ? await tx
        .select({ actorId: actors.id })
        .from(actors)
        .where(eq(actors.userId, configuration.lobby.ownerUserId))
    : [];
  const connections = await fixtureConnections(tx, {
    fixtureId: fixture.id,
    roomId: input.room.id,
    userId: input.userId,
  });
  return {
    configuration,
    funding: input.captureFunder
      ? await loadTournamentCaptureFunding(
          tx,
          input.captureFunder,
          input.userId,
        )
      : null,
    authorization,
    ownerActorId: owner?.actorId ?? null,
    fixtureId: fixture.id,
    connections,
  };
};
export type RoomDirectionInput = NonNullable<
  Awaited<ReturnType<typeof loadRoomDirection>>
>;
