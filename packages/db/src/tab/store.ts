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
  ...createGuardianCommandStore(database),
  ...createFamilyHistoryStore(database),
  ...createDrawCommandStore(database),
  ...createLobbyAdministrationStore(database),
  ...createSettingCommandStore(database),
  ...createSetupCommandStore(database),
  ...createJudgeRegistrationStore(database),
  ...createEntryEnrollmentStore(database),
  ...createStandingRoomDraftStore(database),
  ...createTournamentSetupReadStore(database),
  ...createTournamentEventSettingReadStore(database),
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
          return {
            decision,
            authorization: await loadTabAuthorization(tx, scope, {
              userId: input.senderUserId,
              organization: decision.organization,
              grants: decision.grants,
              memberships: decision.memberships,
              staffMinimumBand: decision.staffMinimumBand,
            }),
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
  lobbyIdOfHandle: (handle: string): Promise<string | null> =>
    database.transaction((tx) => findLobbyByHandle(tx, handle)),
  organizationIdOfHandle: (handle: string): Promise<string | null> =>
    database.transaction((tx) => findOrganizationByHandle(tx, handle)),
});

export type TabStore = ReturnType<typeof createTabStore>;
