import { and, asc, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import type { ReleaseCommand } from '@daisy/protocol/lobby/result-command';
import { readDatabaseTime } from '../database-clock';
import { actors } from '../schema/actors';
import { ballotScreenings } from '../schema/ballot-screenings';
import { ballots } from '../schema/ballots';
import { tabRounds } from '../schema/events';
import { fixtures } from '../schema/fixtures';
import { releases } from '../schema/releases';
import { rounds } from '../schema/rounds';
import { scopeTransaction } from '../tenant-scope';
import { loadAuthorityContext } from './authority-context';
import { appendHistory, storedCommand } from './command-record';
import { lockTabCommandAccounts } from './command-accounts';
import { loadDrawResolutionPool } from './draw-resolution-pool';
import { lockEventSettingContext } from './event-setting-context';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Input = {
  readonly senderUserId: string;
  readonly lobbyId: string;
  readonly command: ReleaseCommand;
};
const load = async (tx: TabTransaction, input: Input) => {
  await scopeTransaction(tx, {
    subjectUserId: input.senderUserId,
    lobbyId: input.lobbyId,
  });
  await lockTabCommandAccounts(tx, [input.senderUserId]);
  const [address] =
    input.command.type === 'release-resolution'
      ? await tx
          .select()
          .from(tabRounds)
          .where(
            and(
              eq(tabRounds.id, input.command.tabRoundId),
              eq(tabRounds.lobbyId, input.lobbyId),
            ),
          )
      : [];
  const eventId =
    input.command.type === 'open-audience'
      ? input.command.eventId
      : address?.eventId;
  if (!eventId) return null;
  const configuration = await lockEventSettingContext(tx, {
    lobbyId: input.lobbyId,
    eventId,
    subjectUserId: input.senderUserId,
  });
  if (!configuration || configuration.lobby.kind !== 'tournament') return null;
  const authorization = await loadAuthorityContext(
    tx,
    configuration.scope,
    input.senderUserId,
  );
  const [owner] = configuration.lobby.ownerUserId
    ? await tx
        .select({ actorId: actors.id })
        .from(actors)
        .where(eq(actors.userId, configuration.lobby.ownerUserId))
    : [];
  const eventRounds = await tx
    .select()
    .from(tabRounds)
    .where(
      and(eq(tabRounds.eventId, eventId), eq(tabRounds.lobbyId, input.lobbyId)),
    )
    .orderBy(asc(tabRounds.id))
    .for('update');
  const target = address
    ? (eventRounds.find((row) => row.id === address.id) ?? null)
    : null;
  return {
    configuration,
    authorization,
    ownerActorId: owner?.actorId ?? null,
    rounds: eventRounds,
    target,
    resolutionPool: target
      ? await loadDrawResolutionPool(tx, configuration, target)
      : null,
    releases: await tx
      .select()
      .from(releases)
      .where(
        and(eq(releases.eventId, eventId), eq(releases.lobbyId, input.lobbyId)),
      ),
    screenings: await tx
      .select({
        ballotId: ballots.id,
        roundId: rounds.id,
        tabRoundId: fixtures.tabRoundId,
        status: ballotScreenings.status,
      })
      .from(fixtures)
      .innerJoin(rounds, eq(rounds.roomId, fixtures.roomId))
      .innerJoin(ballots, eq(ballots.roundId, rounds.id))
      .innerJoin(ballotScreenings, eq(ballotScreenings.ballotId, ballots.id))
      .where(
        and(eq(fixtures.eventId, eventId), eq(fixtures.lobbyId, input.lobbyId)),
      ),
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
};
export type LoadedReleaseCommand = NonNullable<
  Awaited<ReturnType<typeof load>>
>;
export type ReleaseCommandWrite =
  | {
      readonly table: 'releases';
      readonly op: 'insert';
      readonly row: Omit<typeof releases.$inferInsert, 'openedAt'> & {
        readonly openedAt: string;
      };
    }
  | {
      readonly table: 'tab_rounds';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly poolResolutionId: string;
        readonly resolutionReleasedAt: string;
        readonly version: number;
      };
    };

/** Recorded openings and resolution publication share the command receipt's transaction. */
export const createReleaseCommandStore = (database: TabDatabase) => ({
  releaseCommand: <Answer>(
    input: Input,
    work: (session: {
      readonly load: () => Promise<LoadedReleaseCommand | null>;
      readonly stored: (id: string) => ReturnType<typeof storedCommand>;
      readonly apply: (
        writes: readonly ReleaseCommandWrite[],
        history: ActionHistoryEntry,
        receipt: LobbyCommandReceipt,
      ) => Promise<void>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      let loaded: LoadedReleaseCommand | null = null;
      return work({
        load: async () => {
          loaded = await load(tx, input);
          return loaded;
        },
        stored: (id) => storedCommand(tx, id),
        apply: async (writes, history, receipt) => {
          if (!loaded)
            throw createAppError('INVARIANT', 'Release facts not loaded');
          await appendHistory(tx, history, receipt);
          for (const write of writes) {
            if (write.table === 'releases') {
              if (
                write.row.lobbyId !== input.lobbyId ||
                write.row.eventId !== loaded.configuration.event.id ||
                !loaded.rounds.some((row) => row.id === write.row.tabRoundId)
              )
                throw createAppError('INVARIANT', 'Release source changed');
              await tx.insert(releases).values({
                ...write.row,
                openedAt: new Date(write.row.openedAt),
              });
            } else {
              if (
                !loaded.target ||
                write.id !== loaded.target.id ||
                !loaded.resolutionPool?.resolutions.some(
                  (row) =>
                    row.id === write.set.poolResolutionId &&
                    row.retiredAt === null,
                )
              )
                throw createAppError('INVARIANT', 'Resolution source changed');
              const rows = await tx
                .update(tabRounds)
                .set({
                  ...write.set,
                  resolutionReleasedAt: new Date(
                    write.set.resolutionReleasedAt,
                  ),
                  updatedAt: new Date(history.appliedAt),
                })
                .where(
                  and(
                    eq(tabRounds.id, write.id),
                    eq(tabRounds.eventId, loaded.configuration.event.id),
                    eq(tabRounds.lobbyId, input.lobbyId),
                    eq(tabRounds.version, loaded.target.version),
                  ),
                )
                .returning({ id: tabRounds.id });
              if (rows.length !== 1)
                throw createAppError(
                  'INVARIANT',
                  'Resolution write lost its fenced row',
                );
            }
          }
        },
      });
    }),
});
