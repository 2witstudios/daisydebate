import { fixtureRoomSources } from '../schema/fixture-room-sources';
import { and, eq, inArray } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { ResultCommand } from '@daisy/protocol/lobby/result-command';
import type { BreakCommand } from '@daisy/protocol/lobby/break-command';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import type { BallotWrittenRecord } from '@daisy/protocol';
import { readDatabaseTime } from '../database-clock';
import { jsonObjectSchema } from '../schema/columns';
import { results } from '../schema/results';
import { certifications, certificationResults } from '../schema/certifications';
import { releases } from '../schema/releases';
import { ballots } from '../schema/ballots';
import { ballotScreenings } from '../schema/ballot-screenings';
import { rounds } from '../schema/rounds';
import { fixtures } from '../schema/fixtures';
import { scopeTransaction } from '../tenant-scope';
import { lockTabCommandAccounts } from './command-accounts';
import { loadEventCompetition } from './event-competition';
import { storedCommand, appendHistory } from './command-record';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Command =
  | Extract<
      ResultCommand,
      { type: 'certify-result' | 'certify-event' | 'resolve-screening-hold' }
    >
  | BreakCommand;
type Input = {
  readonly senderUserId: string;
  readonly lobbyId: string;
  readonly command: Command;
};
async function load(tx: TabTransaction, input: Input) {
  await scopeTransaction(tx, {
    subjectUserId: input.senderUserId,
    lobbyId: input.lobbyId,
  });
  await lockTabCommandAccounts(tx, [input.senderUserId]);
  const [result] =
    input.command.type === 'certify-result'
      ? await tx
          .select({ eventId: results.eventId })
          .from(results)
          .where(
            and(
              eq(results.id, input.command.resultId),
              eq(results.lobbyId, input.lobbyId),
            ),
          )
      : [];
  const [screened] =
    input.command.type === 'resolve-screening-hold'
      ? await tx
          .select({ eventId: fixtures.eventId })
          .from(ballots)
          .innerJoin(rounds, eq(rounds.id, ballots.roundId))
          .innerJoin(
            fixtureRoomSources,
            eq(fixtureRoomSources.roomId, rounds.roomId),
          )
          .innerJoin(
            fixtures,
            and(
              eq(fixtures.id, fixtureRoomSources.fixtureId),
              eq(fixtures.lobbyId, fixtureRoomSources.lobbyId),
            ),
          )
          .where(
            and(
              eq(ballots.id, input.command.ballotId),
              eq(fixtures.lobbyId, input.lobbyId),
            ),
          )
      : [];
  const eventId =
    'eventId' in input.command
      ? input.command.eventId
      : (result?.eventId ?? screened?.eventId);
  if (!eventId) return null;
  const competition = await loadEventCompetition(tx, {
    viewerUserId: input.senderUserId,
    lobbyId: input.lobbyId,
    eventId,
    strength: 'update',
  });
  if (!competition) return null;
  const currentRounds = await tx
    .select({ roundId: rounds.id, tabRoundId: fixtures.tabRoundId })
    .from(fixtures)
    .innerJoin(rounds, eq(rounds.roomId, fixtures.roomId))
    .where(
      and(eq(fixtures.eventId, eventId), eq(fixtures.lobbyId, input.lobbyId)),
    );
  const sourceRounds = [
    ...new Set([
      ...currentRounds.map((row) => row.roundId),
      ...competition.results.flatMap((row) =>
        row.roundId ? [row.roundId] : [],
      ),
    ]),
  ];
  const submitted = sourceRounds.length
    ? await tx
        .select({ ballot: ballots, screening: ballotScreenings })
        .from(ballots)
        .leftJoin(ballotScreenings, eq(ballotScreenings.ballotId, ballots.id))
        .where(inArray(ballots.roundId, sourceRounds))
    : [];
  return {
    competition,
    currentRounds,
    submitted,
    releases: await tx
      .select()
      .from(releases)
      .where(
        and(eq(releases.eventId, eventId), eq(releases.lobbyId, input.lobbyId)),
      ),
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
}
export type LoadedCompletionCommand = NonNullable<
  Awaited<ReturnType<typeof load>>
>;
export type CompletionWrite =
  | {
      readonly table: 'certifications';
      readonly op: 'insert';
      readonly row: Omit<typeof certifications.$inferInsert, 'certifiedAt'> & {
        readonly certifiedAt: string;
      };
    }
  | {
      readonly table: 'certification_results';
      readonly op: 'insert';
      readonly row: typeof certificationResults.$inferInsert;
    }
  | {
      readonly table: 'releases';
      readonly op: 'insert';
      readonly row: Omit<typeof releases.$inferInsert, 'openedAt'> & {
        readonly openedAt: string;
      };
    }
  | {
      readonly table: 'ballot_screenings';
      readonly op: 'update';
      readonly ballotId: string;
      readonly set: {
        readonly status: 'clear';
        readonly releasedText: BallotWrittenRecord;
        readonly updatedAt: string;
      };
    };

export const createCompletionCommandStore = (database: TabDatabase) => ({
  completionCommand: <Answer>(
    input: Input,
    work: (session: {
      readonly load: () => Promise<LoadedCompletionCommand | null>;
      readonly stored: (id: string) => ReturnType<typeof storedCommand>;
      readonly apply: (
        writes: readonly CompletionWrite[],
        history: ActionHistoryEntry,
        receipt: LobbyCommandReceipt,
      ) => Promise<void>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      let loaded: LoadedCompletionCommand | null = null;
      return work({
        load: async () => {
          loaded = await load(tx, input);
          return loaded;
        },
        stored: (id) => storedCommand(tx, id),
        apply: async (writes, history, receipt) => {
          if (!loaded)
            throw createAppError('INVARIANT', 'Completion facts not loaded');
          const lobbyId = loaded.competition.configuration.lobby.id;
          if (
            history.scope.kind !== 'lobby' ||
            history.scope.lobbyId !== lobbyId
          )
            throw createAppError('INVARIANT', 'Completion tenant changed');
          await appendHistory(tx, history, receipt);
          for (const write of writes) {
            if (write.table === 'ballot_screenings') {
              const updated = await tx
                .update(ballotScreenings)
                .set({
                  ...write.set,
                  releasedText: jsonObjectSchema.parse(write.set.releasedText),
                  updatedAt: new Date(write.set.updatedAt),
                })
                .where(
                  and(
                    eq(ballotScreenings.ballotId, write.ballotId),
                    eq(ballotScreenings.lobbyId, lobbyId),
                    eq(ballotScreenings.status, 'held'),
                  ),
                )
                .returning({ id: ballotScreenings.ballotId });
              if (updated.length !== 1)
                throw createAppError('CONFLICT', 'Screening changed');
              continue;
            }
            if (
              write.row.lobbyId !== lobbyId ||
              write.row.eventId !== loaded.competition.configuration.event.id
            )
              throw createAppError(
                'INVARIANT',
                'Completion write tenant changed',
              );
            switch (write.table) {
              case 'certifications':
                await tx.insert(certifications).values({
                  ...write.row,
                  certifiedAt: new Date(write.row.certifiedAt),
                });
                break;
              case 'certification_results':
                await tx.insert(certificationResults).values(write.row);
                break;
              case 'releases':
                await tx.insert(releases).values({
                  ...write.row,
                  openedAt: new Date(write.row.openedAt),
                });
                break;
            }
          }
        },
      });
    }),
});
