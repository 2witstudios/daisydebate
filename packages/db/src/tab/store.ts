import { createLobbyRoomStore } from './create-lobby-room';
export type {
  CreateLobbyRoomCommand,
  LobbyRoomAssembly,
} from './create-lobby-room';
import { and, eq, sql } from 'drizzle-orm';
import { lobbies } from '../schema/lobbies';
import { createLeagueSeasonStore } from './league-season';
export type { LeagueSeasonFacts } from './league-season';
import { createLeagueRatingStore } from './league-rating-inputs';
export type { LeagueRatingInputs } from './league-rating-inputs';
import { createLeagueSchoolCommandStore } from './league-school-command';
export type {
  LoadedLeagueSchoolCommand,
  LeagueSchoolWrite,
} from './league-school-command';
import { createLobbyPeopleStore } from './lobby-people';
export type { LobbyPeopleFacts } from './lobby-people';
export { roleAuthorityOf } from './authority-facts';
import { createHostRosterStore } from './host-roster';
import { createSanctionCommandStore } from './sanction-command';
export type { SanctionCommandFacts } from './sanction-command';
export type { HostRosterFacts } from './host-roster';
import { createHostEventsStore } from './host-events';
export type { HostEventsFacts } from './host-events';
import { createHostRoundStore } from './host-round';
export type { HostRoundFacts, HostDrawOverviewFacts } from './host-round';
import { createHostResultsStore } from './host-results';
export type { HostResultsFacts } from './host-results';
export type { EventCompletionFacts } from './event-completion';
import { createHostBallotsStore } from './host-ballots';
export type { HostBallotsFacts } from './host-ballots';
import { createCompletionCommandStore } from './completion-command';
export type {
  LoadedCompletionCommand,
  CompletionWrite,
} from './completion-command';
import { createHostNavigationStore } from './host-navigation';
export type { HostNavigationFacts } from './host-navigation';
import { createEventCompetitionStore } from './event-competition';
export type { EventCompetitionFacts } from './event-competition';
import { createConflictWaiverRequestStore } from './conflict-waiver-request';
export type { LoadedConflictWaiverRequest } from './conflict-waiver-request';
import { createConfirmationCommandStore } from './confirmation-command';
export { createConfirmationCommandStore } from './confirmation-command';
export type { ConfirmationOwnerEffects } from './confirmation-command';
export type { LoadedConfirmationCommand } from './confirmation-command-facts';
export type { ConfirmationWrite } from './confirmation-write';
import { createFixtureCommandStore } from './fixture-command';
export type { FixtureWrite } from './fixture-write';
export type { FixtureOwnerEffects } from './fixture-owner-write';
export type { LoadedFixtureCommand } from './fixture-command-facts';
export { FixturePeopleChanged } from './fixture-command-context';
import { createReleaseCommandStore } from './release-command';
export type {
  LoadedReleaseCommand,
  ReleaseCommandWrite,
} from './release-command';
export {
  loadTournamentHostingFacts,
  type TournamentHostingFacts,
} from './tournament-hosting-facts';
import { createTournamentSponsorshipStore } from './tournament-sponsorship';
export type { LoadedTournamentSponsorship } from './tournament-sponsorship';
import {
  loadAccountHostingFacts,
  type AccountHostingFacts,
} from './account-hosting-facts';
export type { AccountHostingFacts } from './account-hosting-facts';
import { createResultCommandStore } from './result-command';
export type { LoadedResultCommand, ResultWrite } from './result-command';
export type { RoomDirectionInput } from './room-direction';
import { createEventBallotReadStore } from './event-ballot-read';
export type { EventBallotFacts } from './event-ballot-read';
import { createTournamentEventSettingReadStore } from './tournament-event-settings';
import { createGuardianCommandStore } from './guardian-command';
import { createFamilyHistoryStore } from './family-history';
export type { FamilyHistoryFacts } from './family-history';
export { GuardianPeopleChanged } from './guardian-command-facts';
export type { LoadedGuardianCommand } from './guardian-command-facts';
export type { GuardianCommandWrite } from './guardian-command-writes';
export type { TournamentEventSettingFacts } from './tournament-event-settings';
import { findLobbyByHandle } from './lobby-handle';
import { createTournamentSetupReadStore } from './tournament-setup-read';
export type { TournamentSetupFacts } from './tournament-setup-read';
import { createDrawCommandStore } from './draw-command';
export { DrawPeopleChanged } from './draw-command-facts';
export type { DrawCommandInput, LoadedDrawCommand } from './draw-command-facts';
export type { DrawWrite } from './draw-write';
export type { DrawRoomAssembly } from './draw-writes';
export { EntryEnrollmentChanged } from './entry-enrollment';
export { EventSettingParentsChanged } from './event-setting-context';
export type { EventSettingContext } from './event-setting-context';
import { createStandingRoomDraftStore } from './standing-room-draft';
export type { StandingRoomDraftFacts } from './standing-room-draft';
import { createEntryEnrollmentStore } from './entry-enrollment';
export type {
  LoadedEntryEnrollment,
  EntryEnrollmentCommand,
} from './entry-enrollment';
export type { EntryEnrollmentWrite } from './entry-enrollment-write';
import { createJudgeRegistrationStore } from './judge-registration';
export type {
  LoadedJudgeRegistration,
  JudgeRegistrationCommand,
} from './judge-registration';
export type { JudgeRegistrationWrite } from './judge-registration-write';
import { storedCreationCommand } from './creation-replay';
import { createSetupCommandStore } from './setup-command';
export type { LoadedSetupCommand } from './setup-command';
export type { SetupWrite } from './setup-write';
import { createSettingCommandStore } from './setting-command';
export type { LoadedSettingCommand } from './setting-command';
export type { SettingGraph } from './setting-graph';
export type { SettingWrite } from './setting-writes';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import {
  appendHistory,
  storedCommand,
  type StoredTabCommand,
} from './command-record';

export { CommandIdTaken } from './command-record';
import {
  fenceOrganizationCommand,
  fenceOrganizationRead,
} from './organization-fence';
import {
  loadTabAuthorization,
  roleAuthorityOf,
  type TabAuthorization,
  type RoleAuthority,
} from './authority-facts';
import {
  loadOrganizationFacts,
  type OrganizationCommandFacts,
  type OrganizationCommandInput,
} from './organization-facts';
import { findOrganizationByHandle } from './organization-handle';
import {
  loadOrganizationPeople,
  type OrganizationPeopleFacts,
} from './organization-people';
import {
  applyOrganizationWrites,
  type OrganizationWrite,
} from './organization-writes';
import type { TabDatabase } from './tab-transaction';
import { createLobbyAdministrationStore } from './lobby-administration';
export type {
  LobbyAdministrationCommand,
  LobbyAdministrationFacts,
} from './lobby-administration-facts';
export type { LobbyAdministrationWrite } from './lobby-administration-writes';

export type { StoredTabCommand } from './command-record';
export type { BoundaryAuthority, TabAccount } from './boundary';
export type { TabDatabase, TabTransaction } from './tab-transaction';
export type {
  GrantAuthority,
  OrganizationAuthority,
  TabAuthorization,
  RoleAuthority,
} from './authority-facts';
export type {
  OrganizationCommandFacts,
  OrganizationCommandInput,
} from './organization-facts';
export type {
  OrganizationPeopleFacts,
  OrganizationPersonRow,
} from './organization-people';
export type { OrganizationWrite } from './organization-writes';
export type { GrantRow } from './grant-rows';
export type { RoleRow } from './role-rows';

/** Everything an organization command reads, loaded in its one transaction. */
export type LoadedOrganizationCommand = {
  readonly hosting: AccountHostingFacts;
  readonly decision: OrganizationCommandFacts;
  /** The sender's authority here. */
  readonly authorization: TabAuthorization;
  /** The role the command gives, or the role of the grant it removes. */
  readonly roleNamed: RoleAuthority | null;
};

/** One organization command's view of the store, inside its transaction. */
export type OrganizationCommandSession = {
  readonly stored: (commandId: string) => Promise<StoredTabCommand | null>;
  readonly load: () => Promise<LoadedOrganizationCommand>;
  readonly apply: (
    writes: readonly OrganizationWrite[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
  ) => Promise<void>;
};

const roleNamedOf = (
  facts: OrganizationCommandFacts,
  command: OrganizationCommandInput['command'],
): RoleAuthority | null => {
  if (command.type === 'give-grant')
    return facts.role === null ? null : roleAuthorityOf(facts.role);
  if (command.type !== 'remove-grant') return null;
  const grant = facts.grants.find(
    (candidate) => candidate.id === command.grantId,
  );
  return grant === undefined ? null : roleAuthorityOf(grant.role);
};

/**
 * The Tab store: each aggregate's commands run in one transaction fenced to
 * their tenant, reading the command record, loading facts under the
 * aggregate's lock, and applying the writes with one history entry. A
 * command id another tenant already recorded throws `CommandIdTaken` from
 * `apply`, and the transaction ends without the command.
 */
export const createTabStore = (database: TabDatabase) => ({
  ...createSanctionCommandStore(database),
  ...createLeagueSeasonStore(database),
  ...createLeagueSchoolCommandStore(database),
  ...createResultCommandStore(database),
  ...createFixtureCommandStore(database),
  ...createConfirmationCommandStore(database),
  ...createConflictWaiverRequestStore(database),
  ...createReleaseCommandStore(database),
  ...createTournamentSponsorshipStore(database),
  ...createGuardianCommandStore(database),
  ...createFamilyHistoryStore(database),
  ...createDrawCommandStore(database),
  ...createEventCompetitionStore(database),
  ...createCompletionCommandStore(database),
  ...createHostNavigationStore(database),
  ...createLobbyPeopleStore(database),
  ...createHostBallotsStore(database),
  ...createHostResultsStore(database),
  ...createHostRoundStore(database),
  ...createHostEventsStore(database),
  ...createLeagueRatingStore(database),
  ...createHostRosterStore(database),
  ...createLobbyAdministrationStore(database),
  ...createSettingCommandStore(database),
  ...createSetupCommandStore(database),
  ...createJudgeRegistrationStore(database),
  ...createEntryEnrollmentStore(database),
  ...createStandingRoomDraftStore(database),
  ...createLobbyRoomStore(database),
  ...createTournamentSetupReadStore(database),
  ...createTournamentEventSettingReadStore(database),
  ...createEventBallotReadStore(database),
  organizationCommand: <Answer>(
    input: OrganizationCommandInput,
    work: (session: OrganizationCommandSession) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      const scope = await fenceOrganizationCommand(tx, input);
      return work({
        stored: async (commandId) => {
          if (input.command.type !== 'create-organization')
            return storedCommand(tx, commandId);
          const existingId = await findOrganizationByHandle(
            tx,
            input.command.handle,
          );
          return existingId === null
            ? storedCommand(tx, commandId)
            : storedCreationCommand(
                tx,
                scope,
                { ...scope, organizationId: existingId },
                commandId,
              );
        },
        load: async () => {
          const decision = await loadOrganizationFacts(tx, input, scope);
          const authorization = await loadTabAuthorization(tx, scope, {
            userId: input.senderUserId,
            organization: decision.organization,
            grants: decision.grants,
            memberships: decision.memberships,
            staffMinimumBand: decision.staffMinimumBand,
          });
          return {
            decision,
            authorization,
            hosting: await loadAccountHostingFacts(tx, input.senderUserId),
            roleNamed: roleNamedOf(decision, input.command),
          };
        },
        apply: async (writes, history, receipt) => {
          await applyOrganizationWrites(tx, writes, scope);
          await appendHistory(tx, history, receipt);
        },
      });
    }),
  organizationPeople: <Answer>(
    input: {
      readonly viewerUserId: string;
      readonly organizationId: string;
    },
    work: (facts: OrganizationPeopleFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      const scope = await fenceOrganizationRead(tx, input);
      return work(await loadOrganizationPeople(tx, input, scope));
    }),
  standingLobbyAddressOfHandle: (
    handle: string,
  ): Promise<{ lobbyId: string; organizationId: string } | null> =>
    database.transaction(async (tx) => {
      const [row] = await tx
        .select({
          lobbyId: lobbies.id,
          organizationId: lobbies.ownerOrganizationId,
        })
        .from(lobbies)
        .where(
          and(
            eq(lobbies.kind, 'standing'),
            eq(sql`lower(${lobbies.handle})`, handle.toLowerCase()),
          ),
        )
        .limit(1);
      return row?.organizationId
        ? { lobbyId: row.lobbyId, organizationId: row.organizationId }
        : null;
    }),
  lobbyIdOfHandle: (handle: string): Promise<string | null> =>
    database.transaction((tx) => findLobbyByHandle(tx, handle)),
  organizationIdOfHandle: (handle: string): Promise<string | null> =>
    database.transaction((tx) => findOrganizationByHandle(tx, handle)),
});

export type TabStore = ReturnType<typeof createTabStore>;
