import { and, eq } from 'drizzle-orm';
import type { JudgeCommand } from '@daisy/protocol/lobby/entry-command';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { organizations } from '../schema/organizations';
import { actors } from '../schema/actors';
import { lobbies } from '../schema/lobbies';
import { events, timeSlots, tabRounds } from '../schema/events';
import {
  tournamentJudges,
  judgeAvailability,
} from '../schema/tournament-judges';
import { fixtureJudges, fixtureEntries, fixtures } from '../schema/fixtures';
import { scopeTransaction } from '../tenant-scope';
import { lockTabCommandAccounts } from './command-accounts';
import { loadTabCounterpart } from './boundary';
import { loadAuthorityContext } from './authority-context';
import {
  appendHistory,
  storedCommand,
  type StoredTabCommand,
} from './command-record';
import { applyJudgeRegistrationWrites } from './judge-registration-writes';
import type { JudgeRegistrationWrite } from './judge-registration-write';
import type { TabDatabase, TabTransaction } from './tab-transaction';

export type JudgeRegistrationCommand = Exclude<
  JudgeCommand,
  { readonly type: 'strike-judge' | 'withdraw-strike' | 'declare-conflict' }
>;
export type JudgeRegistrationInput = {
  readonly lobbyId: string;
  readonly senderUserId: string;
  readonly command: JudgeRegistrationCommand;
  readonly newId: string;
  readonly now: string;
};
const namedJudge = async (
  tx: TabTransaction,
  command: JudgeRegistrationCommand,
  lobbyId: string,
) => {
  const [row] = await tx
    .select()
    .from(tournamentJudges)
    .where(
      and(
        eq(tournamentJudges.lobbyId, lobbyId),
        command.type === 'invite-judge'
          ? eq(tournamentJudges.actorId, command.actorId)
          : eq(tournamentJudges.id, command.tournamentJudgeId),
      ),
    );
  return row ?? null;
};
const load = async (tx: TabTransaction, input: JudgeRegistrationInput) => {
  await scopeTransaction(tx, { subjectUserId: input.senderUserId });
  const [found] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, input.lobbyId));
  const scope = {
    subjectUserId: input.senderUserId,
    organizationId: found?.ownerOrganizationId ?? undefined,
    lobbyId: found?.id,
  };
  await scopeTransaction(tx, scope);
  const named = await namedJudge(tx, input.command, input.lobbyId);
  const actorId =
    input.command.type === 'invite-judge'
      ? input.command.actorId
      : named?.actorId;
  const [actor] = actorId
    ? await tx
        .select({ id: actors.id, userId: actors.userId })
        .from(actors)
        .where(eq(actors.id, actorId))
    : [];
  await lockTabCommandAccounts(
    tx,
    actor?.userId ? [input.senderUserId, actor.userId] : [input.senderUserId],
  );
  const authorization = await loadAuthorityContext(
    tx,
    scope,
    input.senderUserId,
  );
  const [lobby] = found
    ? await tx
        .select()
        .from(lobbies)
        .where(eq(lobbies.id, found.id))
        .for('update')
    : [];
  const [owner] = lobby?.ownerUserId
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, lobby.ownerUserId))
    : [];
  const judge = await namedJudge(tx, input.command, input.lobbyId);
  const [school] =
    input.command.type === 'invite-judge' && input.command.schoolOrganizationId
      ? await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(
            and(
              eq(organizations.id, input.command.schoolOrganizationId),
              eq(organizations.kind, 'school'),
            ),
          )
      : [];
  return {
    schoolFound:
      input.command.type !== 'invite-judge' ||
      input.command.schoolOrganizationId === null ||
      school !== undefined,
    lobby: lobby ?? null,
    authorization,
    ownerActorId: owner?.id ?? null,
    actor: actor ?? null,
    account: actor?.userId
      ? await loadTabCounterpart(tx, actor.userId, scope)
      : null,
    judge,
    eventIds: (
      await tx
        .select({ id: events.id })
        .from(events)
        .where(eq(events.lobbyId, input.lobbyId))
    ).map((row) => row.id),
    timeSlotIds: (
      await tx
        .select({ id: timeSlots.id })
        .from(timeSlots)
        .where(eq(timeSlots.lobbyId, input.lobbyId))
    ).map((row) => row.id),
    availability: judge
      ? await tx
          .select()
          .from(judgeAvailability)
          .where(eq(judgeAvailability.tournamentJudgeId, judge.id))
      : [],
    fixtures: judge
      ? await tx
          .select({
            id: fixtures.id,
            timeSlotId: tabRounds.timeSlotId,
            entryId: fixtureEntries.entryId,
          })
          .from(fixtureJudges)
          .innerJoin(fixtures, eq(fixtures.id, fixtureJudges.fixtureId))
          .innerJoin(tabRounds, eq(tabRounds.id, fixtures.tabRoundId))
          .leftJoin(fixtureEntries, eq(fixtureEntries.fixtureId, fixtures.id))
          .where(
            and(
              eq(fixtureJudges.tournamentJudgeId, judge.id),
              eq(fixtures.status, 'published'),
            ),
          )
      : [],
  };
};
export type LoadedJudgeRegistration = Awaited<ReturnType<typeof load>>;
export type JudgeRegistrationSession = {
  readonly load: () => Promise<LoadedJudgeRegistration>;
  readonly stored: (id: string) => Promise<StoredTabCommand | null>;
  readonly apply: (
    writes: readonly JudgeRegistrationWrite[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
  ) => Promise<void>;
};
export const createJudgeRegistrationStore = (database: TabDatabase) => ({
  judgeRegistrationCommand: <Answer>(
    input: JudgeRegistrationInput,
    work: (session: JudgeRegistrationSession) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) =>
      work({
        load: () => load(tx, input),
        stored: (id) => storedCommand(tx, id),
        apply: async (writes, history, receipt) => {
          await applyJudgeRegistrationWrites(tx, writes);
          await appendHistory(tx, history, receipt);
        },
      }),
    ),
});
