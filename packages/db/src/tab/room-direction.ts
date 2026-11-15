import { fixtureSchoolIds, loadFixtureAudience } from './fixture-audience';
import { fixtureRoomSources } from '../schema/fixture-room-sources';
import {
  loadTournamentCaptureFunding,
  type TournamentCaptureFunderLocator,
} from './tournament-capture-funding';
import { fixtureConnections } from './fixture-conflict';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { fixtures } from '../schema/fixtures';
import { rooms } from '../schema/rooms';
import { scopeTransaction } from '../tenant-scope';
import { loadAuthorityContext } from './authority-context';
import {
  lockEventSettingContext,
  EventSettingParentsChanged,
} from './event-setting-context';
import type { TabTransaction } from './tab-transaction';

/**
 * Tab's read-only input to ordinary Room direction. A snapshot prepares an
 * external consent read; only the reloaded, account-before-parent locked
 * input can authorize a command or replay. No Room host or cast is invented.
 */
const loadFixtureRoomDirection = async (
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
  source: 'current-room' | 'retained-room',
) => {
  if (input.room.hostActorId !== null) return null;
  await scopeTransaction(tx, {
    subjectUserId: input.userId,
    lobbyId: input.room.lobbyId,
  });
  const [found] = await tx
    .select(getTableColumns(fixtures))
    .from(fixtureRoomSources)
    .innerJoin(
      fixtures,
      and(
        eq(fixtures.id, fixtureRoomSources.fixtureId),
        eq(fixtures.lobbyId, fixtureRoomSources.lobbyId),
      ),
    )
    .where(
      and(
        eq(fixtureRoomSources.roomId, input.room.id),
        eq(fixtures.lobbyId, input.room.lobbyId),
        source === 'current-room'
          ? eq(fixtures.roomId, input.room.id)
          : undefined,
        source === 'current-room'
          ? eq(fixtures.status, 'published')
          : undefined,
      ),
    );
  if (!found) return null;
  const schoolIds = await fixtureSchoolIds(tx, found.id);
  const configuration = await lockEventSettingContext(tx, {
    lobbyId: found.lobbyId,
    eventId: found.eventId,
    subjectUserId: input.userId,
    strength: 'share',
    extraOrganizationIds: schoolIds,
    ...(input.snapshot ? { snapshot: true } : {}),
  });
  if (
    !configuration ||
    configuration.lobby.kind !== 'tournament' ||
    (source === 'current-room' && configuration.lobby.closedAt !== null)
  )
    return null;
  if (
    !input.snapshot &&
    JSON.stringify(await fixtureSchoolIds(tx, found.id)) !==
      JSON.stringify(schoolIds)
  )
    throw new EventSettingParentsChanged();
  const query = tx
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.id, found.id),
        eq(fixtures.lobbyId, input.room.lobbyId),
        source === 'current-room'
          ? eq(fixtures.roomId, input.room.id)
          : undefined,
        source === 'current-room'
          ? eq(fixtures.status, 'published')
          : undefined,
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
    audience: await loadFixtureAudience(tx, {
      fixtureId: fixture.id,
      lobbyId: fixture.lobbyId,
      tabRoundId: fixture.tabRoundId,
      userId: input.userId,
      schoolIds,
      scope: configuration.scope,
      ...(input.snapshot ? { snapshot: true } : {}),
    }),
  };
};
export const loadRoomDirection = (
  tx: TabTransaction,
  input: Parameters<typeof loadFixtureRoomDirection>[1],
) => loadFixtureRoomDirection(tx, input, 'current-room');

/** Current authority over the original fixture, even after another Room replaced this one. */
export const loadRoundDirection = (
  tx: TabTransaction,
  input: Pick<
    Parameters<typeof loadFixtureRoomDirection>[1],
    'room' | 'userId'
  >,
) => loadFixtureRoomDirection(tx, input, 'retained-room');

export type RoomDirectionInput = NonNullable<
  Awaited<ReturnType<typeof loadRoomDirection>>
>;
