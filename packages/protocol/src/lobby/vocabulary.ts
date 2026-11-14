/**
 * The closed vocabularies of the lobby, authority and tab record (Daisy Tab
 * architecture and vocabulary pages). Values only: each is the source of a
 * database CHECK, and the commands and reads built around them belong to the
 * protocol and API slice.
 */

/** An organization is a league, or a school or club. */
export const organizationKinds = ['league', 'school'] as const;
export type OrganizationKind = (typeof organizationKinds)[number];

/** Belonging to an organization. It grants nothing; only `active` lets a grant count. */
export const membershipStatuses = [
  'invited',
  'active',
  'declined',
  'ended',
] as const;
export type MembershipStatus = (typeof membershipStatuses)[number];

/**
 * The permissions a role may hold: the grantable capabilities. A capability
 * the evaluator derives is never a permission and never in this list.
 */
export const permissions = [
  'organization.manage',
  'organization.roles.manage',
  'lobby.setup.manage',
  'lobby.announce',
  'action_history.read',
  'tournament.entries.manage',
  'tournament.draw.edit',
  'tournament.draw.publish',
  'tournament.rooms.officiate',
  'tournament.results.enter',
  'tournament.results.release',
  'tournament.ballots.read_unreleased',
  'tournament.resolutions.read_unreleased',
  'school.roster.manage',
  'school.ballots.read',
] as const;
export type Permission = (typeof permissions)[number];

/** Where a grant gives its role. A tournament is a lobby. */
export const grantScopeKinds = ['organization', 'lobby'] as const;
export type GrantScopeKind = (typeof grantScopeKinds)[number];

/** What the evaluator allowed a command under. */
export const commandAuthorities = [
  'fixed',
  'owner',
  'grant',
  'relationship',
  'service',
] as const;
export type CommandAuthority = (typeof commandAuthorities)[number];

/** A guardian link is a relationship between two people, never a role. */
export const guardianLinkKinds = ['parent', 'coach'] as const;
export const guardianLinkStatuses = ['pending', 'active', 'ended'] as const;

/**
 * Who may see video of a guardian's child: officials only, or whoever the
 * lobby's `audience.video` setting opens it to.
 */
export const videoAudienceCaps = ['officials', 'lobby'] as const;

/** The one container of Rooms: open-ended, or bounded with a schedule. */
export const lobbyKinds = ['standing', 'tournament'] as const;
export type LobbyKind = (typeof lobbyKinds)[number];

export const tournamentStatuses = [
  'draft',
  'open',
  'running',
  'completed',
  'cancelled',
] as const;
export type TournamentStatus = (typeof tournamentStatuses)[number];

/** An entry is a person or a team. */
export const entryKinds = ['person', 'team'] as const;
export const entryStatuses = ['pending', 'accepted', 'withdrawn'] as const;
/** Who answers for an entry: a coach through a school, a guardian, or the adult entered. */
export const responsibleKinds = ['school', 'guardian', 'self'] as const;

export const stageKinds = ['preliminary', 'elimination'] as const;
export type StageKind = (typeof stageKinds)[number];
export const stagePlaces = ['online', 'in_person'] as const;
export const stageTimings = ['live', 'windowed'] as const;

export const tournamentJudgeStatuses = [
  'invited',
  'accepted',
  'declined',
  'removed',
] as const;
/** `entry` is the entry's strike; `judge` and `tab` are a declared conflict. */
export const judgeStrikeSources = ['entry', 'judge', 'tab'] as const;

/** A draw is a version of the plan for one tab round. */
export const drawStatuses = ['draft', 'published'] as const;
export const drawMethods = ['typed', 'computed'] as const;

/** What is scheduled for one Room in one tab round; a bye has no Room. */
export const fixtureKinds = ['pairing', 'section', 'bye'] as const;
export type FixtureKind = (typeof fixtureKinds)[number];
/** A fixture moves only forward through these, and is live while `published`. */
export const fixtureStatuses = ['draft', 'published', 'withdrawn'] as const;
export type FixtureStatus = (typeof fixtureStatuses)[number];

/** How a person with authority is connected to a Room. */
export const conflictBases = [
  'seated',
  'school_entry',
  'ward',
  'declared',
] as const;
/** What happens on a conflict: the values of the `conflict.handling` setting. */
export const conflictHandlings = [
  'denied',
  'second_confirms',
  'flagged',
] as const;

/** A command held for a second person's confirmation. */
export const pendingCommandStatuses = [
  'pending',
  'confirmed',
  'declined',
  'withdrawn',
  'lapsed',
] as const;

/** A result comes from its panel's ballots, or is entered by tab. */
export const resultKinds = ['decided', 'administrative'] as const;
export const administrativeResultReasons = [
  'bye',
  'forfeit',
  'double_loss',
  'ruling',
] as const;

/** What a host confirms: one result, or a whole event's. */
export const certificationScopes = ['result', 'event'] as const;

/** The things an audience setting opens, one setting per thing. */
export const releaseThings = [
  'posting',
  'decision',
  'scores',
  'reason',
  'feedback',
  'video',
] as const;
export type ReleaseThing = (typeof releaseThings)[number];

/** Who may see a thing, narrowest first. Officials are not an audience. */
export const audiences = [
  'responsible_adults',
  'competitors',
  'participants',
  'link',
  'public',
] as const;
export type Audience = (typeof audiences)[number];

/** The when that opened a release: every audience setting value but `never`. */
export const releaseCauses = [
  'at_once',
  'round_close',
  'prelims_end',
  'break',
  'certified',
  'manual',
] as const;

/** Screening may hold a ballot's text back from release; it never rewrites it. */
export const ballotScreeningStatuses = ['pending', 'clear', 'held'] as const;

export const sanctionStatuses = [
  'requested',
  'approved',
  'declined',
  'withdrawn',
] as const;
/** How a league's season counts events: by sanction, or by membership. */
export const seasonCountings = ['sanction', 'membership'] as const;
