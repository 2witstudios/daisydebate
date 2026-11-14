import {
  permissionSchema,
  type AuthorizationCapability,
  type Permission,
} from '@daisy/protocol/authorization';
import {
  capabilityMetadata,
  type AuthorizationResourceKind,
} from '@daisy/protocol/capability-metadata';
import { authorize, type AuthorizationInput } from './authorization';
import type {
  ConflictFact,
  GrantFact,
  LeagueAuthorizationFact,
  LobbyAuthorizationFact,
  LobbyScopeFact,
  OrganizationAuthorizationFact,
  TournamentScopeFact,
  ViewingFact,
} from './authorization-lobby-facts';

/** A small closed world the lobby rules are enumerated over. */
export const NOW = '2026-11-13T12:00:00.000Z';
type Resource = AuthorizationInput['resource'];
type Account = NonNullable<AuthorizationInput['context']['account']>;

export const organization = (
  organizationId: string,
  over: Partial<OrganizationAuthorizationFact> = {},
): OrganizationAuthorizationFact => ({
  kind: 'organization',
  organizationId,
  organizationKind: 'league',
  ownerActorIds: [`${organizationId}-owner`],
  member: false,
  standingLobbyIds: [],
  ...over,
});
export const league = organization('league', {
  standingLobbyIds: ['standing'],
}) as LeagueAuthorizationFact;
export const school = organization('school', { organizationKind: 'school' });
/** A league's standing lobby, a person's tournament and the league's tournament. */
export const standing: LobbyScopeFact = {
  lobbyId: 'standing',
  lobbyKind: 'standing',
  owner: { kind: 'organization', organization: league },
};
export const hosted: TournamentScopeFact = {
  lobbyId: 'hosted',
  lobbyKind: 'tournament',
  owner: { kind: 'person', actorId: 'host' },
};
export const leagueTournament: TournamentScopeFact = {
  lobbyId: 'league-tournament',
  lobbyKind: 'tournament',
  owner: { kind: 'organization', organization: league },
};
export const scopes = [standing, hosted, leagueTournament];
/**
 * Any lobby written as the lobby of an event's thing. The fact types refuse
 * a standing lobby there; the cast is what a wrong loader would hand over,
 * so a test can show the evaluator refuses it too.
 */
export const asEventScope = (scope: LobbyScopeFact) =>
  scope as TournamentScopeFact;

export const grant = (over: Partial<GrantFact> = {}): GrantFact => ({
  grantId: 'grant-1',
  scope: { kind: 'lobby', lobbyId: 'hosted' },
  permissions: [],
  roleRank: 1,
  expiresAt: null,
  membershipActive: true,
  staffMinimumBand: 'adult',
  revision: 1,
  ...over,
});
export const lobbyGrant = (
  lobbyId: string,
  permissions: readonly Permission[],
  over: Partial<GrantFact> = {},
) => grant({ scope: { kind: 'lobby', lobbyId }, permissions, ...over });
export const organizationGrant = (
  organizationId: string,
  permissions: readonly Permission[],
  over: Partial<GrantFact> = {},
) =>
  grant({
    scope: { kind: 'organization', organizationId },
    permissions,
    ...over,
  });

export const noViewing: ViewingFact = { audiences: [], releases: [] };
export const noConflict: ConflictFact = {
  connections: [],
  handling: 'second_confirms',
  waiverId: null,
};
export const lobbyFact = (
  scope: LobbyScopeFact,
  over: Partial<LobbyAuthorizationFact> = {},
): LobbyAuthorizationFact => ({
  kind: 'lobby',
  scope,
  viewing: noViewing,
  postingAudiences: [],
  ...over,
});
export const fixture = (
  scope: LobbyScopeFact,
  over: Partial<Extract<Resource, { kind: 'fixture' }>> = {},
): Extract<Resource, { kind: 'fixture' }> => ({
  kind: 'fixture',
  fixtureId: 'fixture',
  scope: asEventScope(scope),
  conflict: noConflict,
  viewing: noViewing,
  ...over,
});

/** One resource of a kind a permission is asked of, in a lobby and its organization. */
export function permissionResource(
  kind: AuthorizationResourceKind,
  scope: LobbyScopeFact,
  owner: OrganizationAuthorizationFact,
): Resource {
  const event = asEventScope(scope);
  const resources: Partial<Record<AuthorizationResourceKind, Resource>> = {
    organization: owner,
    template: { kind: 'template', organization: owner },
    lobby: lobbyFact(scope),
    tab_round: {
      kind: 'tab_round',
      scope: event,
      viewing: noViewing,
      resolutionReleased: false,
    },
    draw: { kind: 'draw', scope: event, viewing: noViewing },
    fixture: fixture(scope),
    ballot: {
      kind: 'ballot',
      scope: event,
      conflict: noConflict,
      viewing: noViewing,
      part: 'decision',
    },
  };
  const resource = resources[kind];
  if (!resource) throw new Error(`no permission is asked of a ${kind}`);
  return resource;
}
export const permissions = permissionSchema.options;
/** Every (permission, resource) pair in one lobby and its organization. */
export const permissionQuestions = (
  scope: LobbyScopeFact,
  owner: OrganizationAuthorizationFact,
) =>
  permissions.flatMap((permission) =>
    capabilityMetadata[permission].resourceKinds.map((kind) => ({
      permission,
      resource: permissionResource(kind, scope, owner),
    })),
  );

export type Asker = {
  readonly actorId?: string | undefined;
  readonly account?: Partial<Account> | undefined;
  readonly grants?: readonly GrantFact[] | undefined;
  readonly now?: string | undefined;
  /** Left out, the question asks only whether the person manages roles. */
  readonly roleGiven?: AuthorizationInput['context']['roleGiven'] | 'omitted';
  readonly counterparts?: AuthorizationInput['context']['counterparts'];
  readonly answer?: AuthorizationInput['context']['answer'];
};
/** An admitted adult asking, unless the asker says otherwise. */
export function ask(
  capability: AuthorizationCapability,
  resource: Resource,
  asker: Asker = {},
) {
  const actorId = asker.actorId ?? 'person';
  return authorize({
    principal: { kind: 'user', userId: actorId, actorId },
    capability,
    resource,
    context: {
      account: {
        userId: actorId,
        actorId,
        member: true,
        erased: false,
        revision: 1,
        beta: { state: 'approved', revision: 1 },
        ageBand: 'adult',
        restricted: false,
        ...asker.account,
      },
      grants: asker.grants ?? [],
      now: asker.now ?? NOW,
      ...(asker.roleGiven === 'omitted'
        ? {}
        : { roleGiven: asker.roleGiven ?? null }),
      ...(asker.counterparts ? { counterparts: asker.counterparts } : {}),
      ...(asker.answer ? { answer: asker.answer } : {}),
    },
  });
}
/** The questions a rule answered yes to, as readable names. */
export const allowed = <Item>(
  items: readonly Item[],
  name: (item: Item) => string,
  decide: (item: Item) => { readonly allow: boolean },
): readonly string[] => items.filter((item) => decide(item).allow).map(name);

type RoomFact = Extract<Resource, { kind: 'room' }>;
type RoundFact = Extract<Resource, { kind: 'round' }>;
type EventOwner = Extract<NonNullable<RoomFact['owner']>, { kind: 'event' }>;
export const eventOwner = (over: Partial<EventOwner> = {}): EventOwner => ({
  kind: 'event',
  fixtureId: 'fixture',
  scope: hosted,
  conflict: noConflict,
  viewing: noViewing,
  video: { minorSeated: false, guardianCap: 'lobby' },
  ...over,
});
const seats = [
  { actorId: 'seat', role: 'affirmative', slot: 0 },
  { actorId: 'judge', role: 'judge', slot: 2 },
];
export const room = (over: Partial<RoomFact> = {}): RoomFact => ({
  kind: 'room',
  roomId: 'room',
  hostActorId: 'creator',
  visibility: 'private',
  status: 'assembling',
  revision: 1,
  participants: seats,
  ...over,
});
export const round = (over: Partial<RoundFact> = {}): RoundFact => ({
  kind: 'round',
  roundId: 'round',
  createdByActorId: 'creator',
  visibility: 'private',
  status: 'completed',
  revision: 1,
  participants: seats,
  ...over,
});
/** An event Room and its Round: no host person, decided through the fixture. */
export const eventRoom = (over: Partial<EventOwner> = {}) =>
  room({ hostActorId: null, owner: eventOwner(over) });
export const eventRound = (over: Partial<EventOwner> = {}) =>
  round({ createdByActorId: null, owner: eventOwner(over) });
