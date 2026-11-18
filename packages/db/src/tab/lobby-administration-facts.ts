import type { AccountHostingFacts } from './account-hosting-facts';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import type { LobbyCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import type { TabAuthorization } from './authority-facts';
import type { StoredTabCommand } from './command-record';
import type { TenantScope } from '../tenant-scope';
import type { LobbyAdministrationWrite } from './lobby-administration-writes';
/** Lifecycle administration, separate from Room assembly and closing active Rooms. */
export type LobbyAdministrationCommand = Exclude<
  LobbyCommand,
  { readonly type: 'create-lobby-room' | 'close-lobby' }
>;
export type LobbyAdministrationInput = {
  readonly senderUserId: string;
  readonly command: LobbyAdministrationCommand;
  readonly newId: string;
  readonly now: string;
};
export type LobbyAdministrationFacts = {
  readonly hosting: AccountHostingFacts;
  readonly organization: TabAuthorization;
  readonly lobby: {
    readonly id: string;
    readonly kind: 'standing' | 'tournament';
    readonly ownerUserId: string | null;
    readonly ownerActorId: string | null;
    readonly ownerOrganizationId: string | null;
    readonly closedAt: string | null;
    readonly version: number;
    readonly status: 'draft' | 'open' | 'running' | 'completed' | 'cancelled';
    readonly admitsMinors: boolean;
  } | null;
  readonly season: {
    readonly id: string;
    readonly organizationId: string;
    readonly status: 'active' | 'closed';
    readonly version: number;
  } | null;
  readonly activeSeasonId: string | null;
  readonly ladder: { readonly id: string; readonly inUse: boolean } | null;
  readonly handleTaken: boolean;
  readonly activity: {
    readonly liveRoundCount: number;
    readonly unresultedFixtureCount: number;
    readonly unstartedEventRoomIds: readonly string[];
  };
  readonly scope: TenantScope;
};
export type LobbyAdministrationSession = {
  readonly stored: (id: string) => Promise<StoredTabCommand | null>;
  readonly load: () => Promise<LobbyAdministrationFacts>;
  readonly apply: (
    writes: readonly LobbyAdministrationWrite[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
  ) => Promise<void>;
};
