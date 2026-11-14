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
  loadOrganizationAuthorization,
  roleAuthorityOf,
  type OrganizationAuthorization,
  type RoleAuthority,
} from './organization-authorization';
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

export type { StoredTabCommand } from './command-record';
export type { BoundaryAuthority, TabAccount } from './boundary';
export type { TabDatabase, TabTransaction } from './tab-transaction';
export type {
  GrantAuthority,
  OrganizationAuthority,
  OrganizationAuthorization,
  RoleAuthority,
} from './organization-authorization';
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
  readonly authorization: OrganizationAuthorization;
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
  organizationCommand: <Answer>(
    input: OrganizationCommandInput,
    work: (session: OrganizationCommandSession) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      const scope = await fenceOrganizationCommand(tx, input);
      return work({
        stored: (commandId) => storedCommand(tx, commandId),
        load: async () => {
          const decision = await loadOrganizationFacts(tx, input, scope);
          return {
            decision,
            authorization: await loadOrganizationAuthorization(tx, scope, {
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
  organizationPeople: (input: {
    readonly viewerUserId: string;
    readonly organizationId: string;
  }): Promise<OrganizationPeopleFacts | null> =>
    database.transaction(async (tx) => {
      const scope = await fenceOrganizationRead(tx, input);
      return loadOrganizationPeople(tx, input, scope);
    }),
  organizationIdOfHandle: (handle: string): Promise<string | null> =>
    database.transaction((tx) => findOrganizationByHandle(tx, handle)),
});

export type TabStore = ReturnType<typeof createTabStore>;
