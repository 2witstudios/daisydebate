import type {
  AuthorizationCapability,
  ConflictConnection,
  ConflictHandling,
  Permission,
} from '@daisy/protocol/authorization';
import type { OrganizationKind } from '@daisy/protocol/capability-metadata';
import type {
  ReleaseAudience,
  ReleaseThing,
} from '@daisy/protocol/release-audience';
import type {
  RoomAuthorizationFact,
  RoundAuthorizationFact,
} from './authorization-facts';

/**
 * The facts the lobby rules read. Loaders hand the evaluator plain values:
 * settings arrive resolved, never as rows, and nothing here is a client
 * claim.
 */
export type OrganizationAuthorizationFact = {
  readonly kind: 'organization';
  readonly organizationId: string;
  readonly organizationKind: OrganizationKind;
  /** Owner is a fixed position, not a role. */
  readonly ownerActorIds: readonly string[];
  /** The principal is an active member. Membership grants nothing. */
  readonly member: boolean;
  /** The standing lobbies the organization owns. */
  readonly standingLobbyIds: readonly string[];
};

type OrganizationOwnerFact = {
  readonly kind: 'organization';
  readonly organization: OrganizationAuthorizationFact;
};
type LobbyOwnerFact =
  { readonly kind: 'person'; readonly actorId: string } | OrganizationOwnerFact;

/** A lobby and who owns it: a standing lobby always has an organization. */
export type LobbyScopeFact =
  | {
      readonly lobbyId: string;
      readonly lobbyKind: 'standing';
      readonly owner: OrganizationOwnerFact;
    }
  | {
      readonly lobbyId: string;
      readonly lobbyKind: 'tournament';
      readonly owner: LobbyOwnerFact;
    };

/** A role given to the principal at an organization or a lobby. */
export type GrantFact = {
  readonly grantId: string;
  readonly scope:
    | { readonly kind: 'organization'; readonly organizationId: string }
    | { readonly kind: 'lobby'; readonly lobbyId: string };
  /** The permissions of the role granted. */
  readonly permissions: readonly Permission[];
  /** The role's seniority: a greater rank outranks a lesser one. */
  readonly roleRank: number;
  readonly expiresAt: string | null;
  /** False once the membership an organization grant rests on has ended. */
  readonly membershipActive: boolean;
  /** `staff.minimum_band` resolved for the granting organization. */
  readonly staffMinimumBand: 'adult' | '16-17';
  readonly revision: number;
};

/** The role a giver proposes to give or remove. */
export type RoleGivenFact = {
  readonly permissions: readonly Permission[];
  readonly roleRank: number;
};

/**
 * The lobbies a guardian allows a minor, plus the tournaments the minor
 * holds an accepted entry in. Null on the account means no boundary.
 */
export type BoundaryFact = {
  readonly allowedLobbyIds: readonly string[];
  readonly entryLobbyIds: readonly string[];
  readonly revision: number;
};

/** Another person an action reaches, and the lobbies both people are in. */
export type CounterpartFact = {
  readonly actorId: string;
  readonly lobbies: readonly LobbyScopeFact[];
};

/**
 * The principal against one fixture: every connection found, the resolved
 * `conflict.handling`, and the confirmed waiver if a second person gave one.
 */
export type ConflictFact = {
  readonly connections: readonly ConflictConnection[];
  readonly handling: ConflictHandling;
  readonly waiverId: string | null;
};

/** The audiences a loader can place a viewer in; `link` and `public` hold for anyone asking by id. */
export type ViewerAudience = Exclude<ReleaseAudience, 'link' | 'public'>;

/** What a viewer is to one event's things, and the releases written for them. */
export type ViewingFact = {
  readonly audiences: readonly ViewerAudience[];
  readonly releases: readonly {
    readonly thing: ReleaseThing;
    readonly audience: ReleaseAudience;
  }[];
};

/** The people seated where a video was made. */
export type VideoSubjectsFact = {
  readonly minorSeated: boolean;
  /** The strictest cap a guardian set on a seated ward; `lobby` caps nothing. */
  readonly guardianCap: 'officials' | 'lobby';
};

/** What a Room or Round in a lobby is decided through. */
export type RoomOwnerFact =
  | { readonly kind: 'person'; readonly scope: LobbyScopeFact }
  | {
      readonly kind: 'event';
      readonly fixtureId: string;
      readonly scope: LobbyScopeFact;
      readonly conflict: ConflictFact;
      readonly viewing: ViewingFact;
      readonly video: VideoSubjectsFact;
    };

export type LobbyAuthorizationFact = {
  readonly kind: 'lobby';
  readonly scope: LobbyScopeFact;
  /** The viewer's audiences here, and the releases of the event asked about. */
  readonly viewing: ViewingFact;
  /** The audiences `audience.posting`, resolved at the lobby, ever opens to. */
  readonly postingAudiences: readonly ReleaseAudience[];
};
type TemplateAuthorizationFact = {
  readonly kind: 'template';
  readonly organization: OrganizationAuthorizationFact;
};
type MembershipAuthorizationFact = {
  readonly kind: 'membership';
  readonly organizationId: string;
  readonly actorId: string;
  readonly status: 'invited' | 'active' | 'declined' | 'ended';
};
type GuardianLinkAuthorizationFact = {
  readonly kind: 'guardian_link';
  readonly guardianActorId: string;
  readonly wardActorId: string;
  /** The school a coach's link is made through; null for a parent's. */
  readonly via: OrganizationAuthorizationFact | null;
};
type OrganizationCollectionAuthorizationFact = {
  readonly kind: 'organization_collection';
  readonly proposedKind: OrganizationKind;
};
type LobbyCollectionAuthorizationFact = {
  readonly kind: 'lobby_collection';
  readonly proposed:
    | {
        readonly lobbyKind: 'tournament';
        readonly owner: { readonly kind: 'person' } | OrganizationOwnerFact;
      }
    | { readonly lobbyKind: 'standing'; readonly owner: OrganizationOwnerFact };
};
type EntryAuthorizationFact = {
  readonly kind: 'entry';
  readonly scope: LobbyScopeFact;
  /** Who answers for the entry. */
  readonly responsible:
    | {
        readonly kind: 'school';
        readonly school: OrganizationAuthorizationFact;
      }
    | { readonly kind: 'guardian'; readonly guardianActorId: string }
    | { readonly kind: 'self'; readonly actorId: string };
};
type JudgeAuthorizationFact = {
  readonly kind: 'judge';
  readonly scope: LobbyScopeFact;
  readonly actorId: string;
};
type TabRoundAuthorizationFact = {
  readonly kind: 'tab_round';
  readonly scope: LobbyScopeFact;
  readonly viewing: ViewingFact;
  readonly resolutionReleased: boolean;
};
type DrawAuthorizationFact = {
  readonly kind: 'draw';
  readonly scope: LobbyScopeFact;
  readonly viewing: ViewingFact;
};
export type FixtureAuthorizationFact = {
  readonly kind: 'fixture';
  readonly fixtureId: string;
  readonly scope: LobbyScopeFact;
  readonly conflict: ConflictFact;
  readonly viewing: ViewingFact;
};
export type BallotAuthorizationFact = {
  readonly kind: 'ballot';
  readonly scope: LobbyScopeFact;
  readonly conflict: ConflictFact;
  readonly viewing: ViewingFact;
  /** The part of the ballot asked for; each opens by its own setting. */
  readonly part: Extract<
    ReleaseThing,
    'decision' | 'scores' | 'reason' | 'feedback'
  >;
};
/** A command held until a second person confirms it. */
type PendingCommandAuthorizationFact = {
  readonly kind: 'pending_command';
  readonly proposerActorId: string;
  /** The capability the held command needs, on the resource it acts on. */
  readonly capability: AuthorizationCapability;
  readonly target:
    | FixtureAuthorizationFact
    | BallotAuthorizationFact
    | RoomAuthorizationFact
    | RoundAuthorizationFact;
};
type SanctionAuthorizationFact = {
  readonly kind: 'sanction';
  readonly league: OrganizationAuthorizationFact;
  /** The lobby of the event the sanction is for. */
  readonly scope: LobbyScopeFact;
};

/** Every resource the lobby rules decide. */
export type LobbyResourceFact =
  | OrganizationCollectionAuthorizationFact
  | OrganizationAuthorizationFact
  | MembershipAuthorizationFact
  | GuardianLinkAuthorizationFact
  | LobbyCollectionAuthorizationFact
  | LobbyAuthorizationFact
  | TemplateAuthorizationFact
  | EntryAuthorizationFact
  | JudgeAuthorizationFact
  | TabRoundAuthorizationFact
  | DrawAuthorizationFact
  | FixtureAuthorizationFact
  | BallotAuthorizationFact
  | PendingCommandAuthorizationFact
  | SanctionAuthorizationFact;
