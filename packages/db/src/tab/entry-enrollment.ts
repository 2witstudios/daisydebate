import { and, eq, inArray } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { EntryCommand } from '@daisy/protocol/lobby/entry-command';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { actors } from '../schema/actors';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { entries, entryMembers } from '../schema/entries';
import { tabRounds } from '../schema/events';
import { draws } from '../schema/draws';
import { tournamentJudges } from '../schema/tournament-judges';
import { fixtureJudges, fixtures } from '../schema/fixtures';
import { scopeTransaction } from '../tenant-scope';
import { lockTabCommandAccounts } from './command-accounts';
import { loadAuthorityContext } from './authority-context';
import { loadEntryPeople } from './entry-person-rows';
import { lockEventSettingContext } from './event-setting-context';
import {
  appendHistory,
  storedCommand,
  type StoredTabCommand,
} from './command-record';
import { applyEntryEnrollmentWrites } from './entry-enrollment-writes';
import { loadTournamentHostingFacts } from './tournament-hosting-facts';
import type { EntryEnrollmentWrite } from './entry-enrollment-write';
import type { TabDatabase, TabTransaction } from './tab-transaction';
export type EntryEnrollmentCommand = Exclude<
  EntryCommand,
  { readonly type: 'replace-entry-member' | 'choose-break' }
>;
/** The accepted entry membership changed while its account fences were acquired. */
export class EntryEnrollmentChanged extends Error {}

export type EntryEnrollmentInput = {
  readonly lobbyId: string;
  readonly senderUserId: string;
  readonly command: EntryEnrollmentCommand;
  readonly newId: string;
  readonly now: string;
};
const load = async (tx: TabTransaction, input: EntryEnrollmentInput) => {
  await scopeTransaction(tx, { subjectUserId: input.senderUserId });
  const [found] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, input.lobbyId));
  let scope = {
    subjectUserId: input.senderUserId,
    organizationId: found?.ownerOrganizationId ?? undefined,
    lobbyId: found?.id,
  };
  await scopeTransaction(tx, scope);
  const [entry] =
    input.command.type === 'submit-entry'
      ? []
      : await tx
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.id, input.command.entryId),
              eq(entries.lobbyId, input.lobbyId),
            ),
          );
  const eventId =
    input.command.type === 'submit-entry'
      ? input.command.eventId
      : entry?.eventId;
  const namedActorIds =
    input.command.type === 'submit-entry'
      ? input.command.memberActorIds
      : entry
        ? (
            await tx
              .select({ actorId: entryMembers.actorId })
              .from(entryMembers)
              .where(eq(entryMembers.entryId, entry.id))
          ).map((row) => row.actorId)
        : [];
  const namedActors = namedActorIds.length
    ? await tx
        .select({ userId: actors.userId })
        .from(actors)
        .where(inArray(actors.id, namedActorIds))
    : [];
  await lockTabCommandAccounts(tx, [
    input.senderUserId,
    ...namedActors.flatMap((row) => (row.userId === null ? [] : [row.userId])),
  ]);
  const schoolId =
    input.command.type === 'submit-entry' &&
    input.command.responsible.kind === 'school'
      ? input.command.responsible.schoolOrganizationId
      : entry?.schoolOrganizationId;
  const configuration = eventId
    ? await lockEventSettingContext(tx, {
        lobbyId: input.lobbyId,
        eventId,
        subjectUserId: input.senderUserId,
        extraOrganizationIds: schoolId ? [schoolId] : [],
      })
    : null;
  if (configuration)
    scope = {
      subjectUserId: input.senderUserId,
      organizationId: configuration.lobby.ownerOrganizationId ?? undefined,
      lobbyId: configuration.lobby.id,
    };
  await scopeTransaction(tx, scope);
  const authorization = await loadAuthorityContext(
    tx,
    scope,
    input.senderUserId,
    'share',
  );
  const lobby = configuration?.lobby ?? found ?? null;
  const event = configuration?.event ?? null;
  const [owner] = lobby?.ownerUserId
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, lobby.ownerUserId))
    : [];
  // Locks the tournament row, so every event's entries count against one cap in turn.
  const hosting = lobby ? await loadTournamentHostingFacts(tx, lobby.id) : null;
  const currentEntries = await tx
    .select()
    .from(entries)
    .where(eq(entries.lobbyId, input.lobbyId));
  const currentEntry = entry
    ? (currentEntries.find((row) => row.id === entry.id) ?? null)
    : null;
  const members = await tx
    .select()
    .from(entryMembers)
    .where(eq(entryMembers.lobbyId, input.lobbyId));
  const currentActorIds =
    input.command.type === 'submit-entry'
      ? input.command.memberActorIds
      : members
          .filter((member) => member.entryId === currentEntry?.id)
          .map((member) => member.actorId);
  if (currentActorIds.some((id) => !namedActorIds.includes(id)))
    throw new EntryEnrollmentChanged();
  const people = await loadEntryPeople(tx, scope, currentActorIds);
  const [school] = schoolId
    ? await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(eq(organizations.id, schoolId), eq(organizations.kind, 'school')),
        )
    : [];
  if (school)
    await scopeTransaction(tx, { ...scope, organizationId: school.id });
  const schoolAuthorization = school
    ? await loadAuthorityContext(
        tx,
        { ...scope, organizationId: school.id },
        input.senderUserId,
        'share',
      )
    : null;
  // The school's grants are read under its scope, then the entry's scope is restored.
  await scopeTransaction(tx, scope);
  const guardianLinkId =
    input.command.type === 'submit-entry' &&
    input.command.responsible.kind === 'guardian'
      ? input.command.responsible.guardianLinkId
      : currentEntry?.guardianLinkId;
  const guardian =
    people
      .flatMap((person) => person.links)
      .find((link) => link.id === guardianLinkId) ?? null;
  const [guardianActor] = guardian
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, guardian.guardianUserId))
    : [];
  return {
    scope,
    lobby: lobby ?? null,
    event: event ?? null,
    entry: currentEntry,
    people,
    authorization,
    schoolAuthorization,
    guardian,
    guardianActorId: guardianActor?.id ?? null,
    ownerActorId: owner?.id ?? null,
    configuration,
    hosting,
    entries: currentEntries,
    members,
    rounds: await tx
      .select()
      .from(tabRounds)
      .where(eq(tabRounds.lobbyId, input.lobbyId)),
    draws: await tx
      .select({ eventId: draws.eventId, status: draws.status })
      .from(draws)
      .where(eq(draws.lobbyId, input.lobbyId)),
    seatedJudges: await tx
      .select({
        actorId: tournamentJudges.actorId,
        timeSlotId: tabRounds.timeSlotId,
      })
      .from(fixtureJudges)
      .innerJoin(
        tournamentJudges,
        eq(tournamentJudges.id, fixtureJudges.tournamentJudgeId),
      )
      .innerJoin(fixtures, eq(fixtures.id, fixtureJudges.fixtureId))
      .innerJoin(tabRounds, eq(tabRounds.id, fixtures.tabRoundId))
      .where(
        and(
          eq(fixtures.lobbyId, input.lobbyId),
          eq(fixtures.status, 'published'),
        ),
      ),
  };
};
export type LoadedEntryEnrollment = Awaited<ReturnType<typeof load>>;
export type EntryEnrollmentSession = {
  readonly load: () => Promise<LoadedEntryEnrollment>;
  readonly stored: (id: string) => Promise<StoredTabCommand | null>;
  readonly apply: (
    writes: readonly EntryEnrollmentWrite[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
  ) => Promise<void>;
};
export const createEntryEnrollmentStore = (database: TabDatabase) => ({
  entryEnrollmentCommand: <Answer>(
    input: EntryEnrollmentInput,
    work: (session: EntryEnrollmentSession) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      let loaded: LoadedEntryEnrollment | null = null;
      return work({
        load: async () => {
          loaded = await load(tx, input);
          return loaded;
        },
        stored: (id) => storedCommand(tx, id),
        apply: async (writes, history, receipt) => {
          if (loaded === null)
            throw createAppError(
              'INVARIANT',
              'Entry command facts were not loaded',
            );
          await applyEntryEnrollmentWrites(
            tx,
            writes,
            loaded.scope,
            loaded.people,
          );
          await appendHistory(tx, history, receipt);
        },
      });
    }),
});
