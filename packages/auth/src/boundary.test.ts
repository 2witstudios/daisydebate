import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  authorizationCapabilitySchema,
  type AuthorizationCapability,
} from '@daisy/protocol/authorization';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import type { AuthorizationInput } from './authorization';
import {
  boundaryFilter,
  insideBoundary,
  type BoundaryFilter,
} from './authorization-boundary';
import type {
  BoundaryFact,
  LobbyScopeFact,
  TournamentScopeFact,
} from './authorization-lobby-facts';
import {
  asEventScope,
  ask,
  eventRoom,
  fixture,
  hosted,
  league,
  leagueTournament,
  lobbyFact,
  lobbyGrant,
  noConflict,
  noViewing,
  organization,
  room,
  round,
  standing,
} from './lobby.test-support';

setupRitewayBun();

type Resource = AuthorizationInput['resource'];
const otherLeague = organization('other-league', {
  standingLobbyIds: ['other-standing'],
});
const otherStanding: LobbyScopeFact = {
  lobbyId: 'other-standing',
  lobbyKind: 'standing',
  owner: { kind: 'organization', organization: otherLeague },
};
const otherTournament: TournamentScopeFact = {
  lobbyId: 'other-tournament',
  lobbyKind: 'tournament',
  owner: { kind: 'organization', organization: otherLeague },
};
const lobbies = [
  standing,
  hosted,
  leagueTournament,
  otherStanding,
  otherTournament,
];
const lobbyIds = lobbies.map((scope) => scope.lobbyId);
const subsets = <Item>(items: readonly Item[]): Item[][] =>
  Array.from({ length: 2 ** items.length }, (_, bits) =>
    items.filter((_item, index) => (bits >> index) & 1),
  );
const boundaries: readonly BoundaryFact[] = subsets(lobbyIds).flatMap(
  (allowedLobbyIds) =>
    subsets(lobbyIds).map((entryLobbyIds) => ({
      allowedLobbyIds,
      entryLobbyIds,
      revision: 1,
    })),
);
const boundary = (
  allowedLobbyIds: readonly string[],
  entryLobbyIds: readonly string[] = [],
) => ({
  boundary: { allowedLobbyIds, entryLobbyIds, revision: 1 },
});
const everyone = { audiences: [], releases: [] };

/**
 * One resource in a lobby for each capability that can be asked of a thing
 * in one. A tournament capability is asked only of tournaments below.
 */
const inLobby = (scope: LobbyScopeFact): Record<string, Resource> => {
  const event = asEventScope(scope);
  const ownedRoom = room({
    visibility: 'public',
    owner: { kind: 'person', scope },
  });
  const ownedRound = round({
    visibility: 'public',
    owner: { kind: 'person', scope },
  });
  const lobby = lobbyFact(scope, { postingAudiences: ['public'] });
  const draw: Resource = { kind: 'draw', scope: event, viewing: everyone };
  const tabRound: Resource = {
    kind: 'tab_round',
    scope: event,
    viewing: everyone,
    resolutionReleased: true,
  };
  const judge: Resource = { kind: 'judge', scope: event, actorId: 'person' };
  return {
    'round.read': ownedRound,
    'round.observe.undelayed': ownedRound,
    'room.list': lobby,
    'room.read': ownedRoom,
    'room.join': ownedRoom,
    'room.manage': ownedRoom,
    'lobby.read': lobby,
    'lobby.host.read': lobby,
    'lobby.room.create': lobbyFact(scope, {
      viewing: { audiences: ['participants'], releases: [] },
    }),
    'organization.roles.manage': lobby,
    'lobby.setup.manage': lobby,
    'lobby.announce': lobby,
    'action_history.read': lobby,
    'tournament.entries.manage': lobby,
    'tournament.draw.edit': draw,
    'tournament.draw.publish': draw,
    'tournament.rooms.officiate': fixture(scope),
    'tournament.results.enter': fixture(scope),
    'tournament.results.release': lobby,
    'tournament.ballots.read_unreleased': fixture(scope),
    'tournament.resolutions.read_unreleased': tabRound,
    'judge.invitation.respond': judge,
    'judge.availability.update': judge,
    'sanction.read': { kind: 'sanction', league, scope: event },
    'posting.read': draw,
    'result.read': fixture(scope),
    'ballot.read': {
      kind: 'ballot',
      scope: event,
      conflict: noConflict,
      viewing: noViewing,
      part: 'scores',
    },
    'standings.read': lobbyFact(scope),
    'resolution.read': tabRound,
  };
};
/** Lobby-reach capabilities asked of no lobby: an organization, or nothing. */
const outsideAnyLobby = [
  'room.create',
  'organization.manage',
  'school.roster.manage',
  'school.ballots.read',
  'organization.host.read',
];
const lobbyReach = authorizationCapabilitySchema.options.filter(
  (capability) => capabilityMetadata[capability].reach === 'lobby',
);
const reason = (decision: ReturnType<typeof ask>) =>
  decision.allow ? 'allow' : decision.reason;

/** A listing's `where` clause, read as SQL would read it over lobby rows. */
const listed = (filter: BoundaryFilter, row: LobbyScopeFact): boolean =>
  filter.kind === 'unbounded' ||
  filter.lobbyIds.includes(row.lobbyId) ||
  (row.lobbyKind === 'tournament' &&
    (filter.tournamentLobbyIds.includes(row.lobbyId) ||
      (row.owner.kind === 'organization' &&
        row.owner.organization.standingLobbyIds.some((lobbyId) =>
          filter.ownerStandingLobbyIds.includes(lobbyId),
        ))));

describe('a minor’s boundary', () => {
  test('puts a lobby inside by the guardian’s list, an entry, or the league’s lobby', () => {
    const allowed = boundary(['standing'], ['hosted']).boundary;
    assert({
      given:
        'a guardian who allows one league’s standing lobby, and a minor entered in a hosted tournament',
      should:
        'put inside that lobby, the tournament entered, and the league’s tournaments, and nothing else',
      actual: lobbies
        .filter((scope) => insideBoundary(allowed, scope))
        .map((scope) => scope.lobbyId),
      expected: ['standing', 'hosted', 'league-tournament'],
    });
    assert({
      given:
        'an entry recorded against a standing lobby, and no boundary at all',
      should:
        'not widen a standing lobby by entry, and put everything inside without a boundary',
      actual: [
        insideBoundary(boundary([], ['standing']).boundary, standing),
        lobbies.every((scope) => insideBoundary(null, scope)),
      ],
      expected: [false, true],
    });
  });

  test('denies every lobby capability outside it and none inside it', () => {
    const cases = lobbyReach
      .filter((capability) => !outsideAnyLobby.includes(capability))
      .flatMap((capability) =>
        lobbies
          .map((scope) => ({
            capability,
            scope,
            resource: inLobby(scope)[capability]!,
          }))
          .filter(({ capability, scope }) => {
            const kind = capabilityMetadata[capability].lobbyKind;
            return kind === null || kind === scope.lobbyKind;
          }),
      );
    assert({
      given:
        'every lobby-reach capability in every lobby, for every boundary over five lobbies',
      should:
        'be denied as restricted exactly when the lobby is outside the boundary',
      actual: boundaries.flatMap((bounds) =>
        cases.filter(({ capability, scope, resource }) => {
          const restricted =
            reason(
              ask(capability, resource, { account: { boundary: bounds } }),
            ) === 'restricted';
          return restricted === insideBoundary(bounds, scope);
        }),
      ).length,
      expected: 0,
    });
    assert({
      given: 'the lobby-reach capabilities the cases cover',
      should:
        'be every one the protocol names, but those asked of an organization or of no lobby',
      actual: [...Object.keys(inLobby(standing)), ...outsideAnyLobby].sort(),
      expected: [...lobbyReach].sort(),
    });
  });

  test('treats a lobby whose facts were not loaded as outside', () => {
    assert({
      given:
        'a bounded minor reading a Room with no lobby fact, listing with no lobby, and an adult doing the same',
      should: 'restrict the minor and leave the adult as before',
      actual: [
        reason(
          ask('room.read', room({ visibility: 'public' }), {
            account: boundary(['standing']),
          }),
        ),
        reason(
          ask(
            'room.list',
            { kind: 'room_collection' },
            { account: boundary(['standing']) },
          ),
        ),
        reason(ask('room.read', room({ visibility: 'public' }))),
        reason(ask('room.list', { kind: 'room_collection' })),
      ],
      expected: ['restricted', 'restricted', 'allow', 'allow'],
    });
  });

  test('lets a minor leave what they are already in', () => {
    assert({
      given: 'a bounded minor seated in an event Room outside the boundary',
      should: 'refuse to read it and still let them leave',
      actual: (['room.read', 'room.leave'] as const).map((capability) =>
        reason(
          ask(capability, eventRoom({ scope: otherTournament }), {
            actorId: 'seat',
            account: boundary(['standing']),
          }),
        ),
      ),
      expected: ['restricted', 'allow'],
    });
  });

  test('is not opened by a role, a host view or a judging invitation', () => {
    const teenStaff = (allowedLobbyIds: readonly string[]) => ({
      account: { ageBand: '16-17' as const, ...boundary(allowedLobbyIds) },
      grants: [
        lobbyGrant('hosted', ['tournament.entries.manage', 'lobby.announce'], {
          staffMinimumBand: '16-17',
        }),
      ],
    });
    const asked = (allowedLobbyIds: readonly string[]) => [
      ...(
        [
          'lobby.host.read',
          'tournament.entries.manage',
          'lobby.announce',
        ] as const
      ).map((capability) =>
        reason(ask(capability, lobbyFact(hosted), teenStaff(allowedLobbyIds))),
      ),
      reason(
        ask(
          'judge.invitation.respond',
          { kind: 'judge', scope: hosted, actorId: 'person' },
          teenStaff(allowedLobbyIds),
        ),
      ),
    ];
    assert({
      given:
        'a bounded 16-17 with a usable role at a tournament and a judging invitation there, the tournament outside the boundary and then inside it',
      should: 'restrict all four outside and allow all four inside',
      actual: [asked(['standing']), asked(['hosted'])],
      expected: [Array(4).fill('restricted'), Array(4).fill('allow')],
    });
  });

  test('never stops a decline', () => {
    const outside = { account: boundary(['standing']) };
    const judge: Resource = {
      kind: 'judge',
      scope: hosted,
      actorId: 'person',
    };
    assert({
      given:
        'a bounded minor answering a judging invitation outside the boundary: no answer named, an accept, a decline',
      should: 'bound the first two as an accept and never the decline',
      actual: [undefined, 'accept' as const, 'decline' as const].map((answer) =>
        reason(ask('judge.invitation.respond', judge, { ...outside, answer })),
      ),
      expected: ['restricted', 'restricted', 'allow'],
    });
    assert({
      given: 'a decline named under a capability that is not an answer',
      should: 'bound it all the same',
      actual: reason(
        ask('lobby.read', lobbyFact(hosted, { postingAudiences: ['public'] }), {
          ...outside,
          answer: 'decline',
        }),
      ),
      expected: 'restricted',
    });
  });

  test('bounds an organization by membership or an allowed lobby, and making a Room by its lobby', () => {
    const teen = (member: boolean, organizationId: string) =>
      reason(
        ask(
          'organization.host.read',
          organization(organizationId, {
            member,
            standingLobbyIds: [`${organizationId}-standing`],
          }),
          {
            account: { ageBand: '16-17', ...boundary(['league-standing']) },
            grants: [
              {
                ...lobbyGrant('unused', [], { staffMinimumBand: '16-17' }),
                scope: { kind: 'organization', organizationId },
              },
            ],
          },
        ),
      );
    assert({
      given:
        'a bounded 16-17 with a role at a league whose lobby is allowed, at one they belong to, and at one that is neither',
      should: 'restrict the host view of the last only',
      actual: [
        teen(false, 'league'),
        teen(true, 'other-league'),
        teen(false, 'other-league'),
      ],
      expected: ['allow', 'allow', 'restricted'],
    });
    assert({
      given: 'a bounded minor and an adult making a Room in no lobby',
      should: 'restrict the minor, like every other way into such a Room',
      actual: [
        reason(
          ask(
            'room.create',
            { kind: 'room_collection' },
            { account: boundary(['standing']) },
          ),
        ),
        reason(ask('room.create', { kind: 'room_collection' })),
      ],
      expected: ['restricted', 'allow'],
    });
  });

  test('bounds the held command a minor confirms', () => {
    const confirm = (allowedLobbyIds: readonly string[]) =>
      reason(
        ask(
          'command.confirm',
          {
            kind: 'pending_command',
            proposerActorId: 'proposer',
            capability: 'tournament.results.enter',
            target: fixture(hosted),
          },
          {
            account: { ageBand: '16-17', ...boundary(allowedLobbyIds) },
            grants: [
              lobbyGrant('hosted', ['tournament.results.enter'], {
                staffMinimumBand: '16-17',
              }),
            ],
          },
        ),
      );
    assert({
      given:
        'a bounded 16-17 holding the held command’s permission, its tournament outside the boundary and then inside',
      should: 'restrict the first and allow the second',
      actual: [confirm(['standing']), confirm(['hosted'])],
      expected: ['restricted', 'allow'],
    });
  });

  test('a listing filtered in SQL admits exactly the lobbies the evaluator admits', () => {
    assert({
      given: 'every boundary over five lobbies, and no boundary',
      should:
        'list by the exported filter exactly the lobbies `lobby.read` allows',
      actual: [...boundaries, null].flatMap((bounds) =>
        lobbies.filter(
          (scope) =>
            listed(boundaryFilter({ boundary: bounds }), scope) !==
            ask(
              'lobby.read',
              lobbyFact(scope, { postingAudiences: ['public'] }),
              {
                account: { boundary: bounds },
              },
            ).allow,
        ),
      ).length,
      expected: 0,
    });
    assert({
      given: 'an account with no boundary and no account',
      should: 'filter nothing',
      actual: [
        boundaryFilter({ boundary: null }),
        boundaryFilter({}),
        boundaryFilter(null),
      ],
      expected: Array(3).fill({ kind: 'unbounded' }),
    });
  });
});

describe('a minor reaching another person', () => {
  const pair: Resource = {
    kind: 'contact_pair',
    lowActorId: 'other',
    highActorId: 'person',
    blocked: false,
    revision: 1,
  };
  const reach = (
    capability: AuthorizationCapability,
    lobbiesShared: readonly LobbyScopeFact[] | null,
  ) =>
    reason(
      ask(capability, pair, {
        account: boundary(['standing']),
        counterparts: lobbiesShared
          ? [{ actorId: 'other', lobbies: lobbiesShared }]
          : undefined,
      }),
    ) === 'restricted';
  test('needs a lobby inside the boundary that both are in', () => {
    assert({
      given:
        'a friend request to a person met in an allowed lobby, in a lobby outside, and with no fact loaded',
      should: 'restrict the last two only',
      actual: [
        reach('social.friend.request', [otherStanding, standing]),
        reach('social.friend.request', [otherStanding]),
        reach('social.friend.request', null),
        reach('social.challenge.send', [leagueTournament]),
      ],
      expected: [false, true, true, false],
    });
  });
  test('covers answering an approach as well as making one', () => {
    const restricted = (
      capability: AuthorizationCapability,
      resource: Resource,
      reachable: readonly string[],
    ) =>
      reason(
        ask(capability, resource, {
          account: boundary(['standing']),
          counterparts: reachable.map((actorId) => ({
            actorId,
            lobbies: [standing],
          })),
        }),
      ) === 'restricted';
    const invitation: Resource = {
      kind: 'group_invitation',
      channel: {
        channelId: 'c',
        kind: 'private_group',
        policyKey: 'social.private_group',
        policyRevision: 1,
        revision: 1,
        lifecycle: 'active',
        activeMemberActorIds: ['inviter', 'member'],
      },
      invitation: {
        channelId: 'c',
        inviterActorId: 'inviter',
        inviteeActorId: 'person',
        state: 'pending',
        generation: 1,
      },
      inviterGrant: { actorId: 'inviter', role: 'manager', generation: 1 },
      contactPairs: [],
    };
    const request: Resource = {
      kind: 'channel',
      channelId: 'c',
      policyKey: 'social.dm',
      policyRevision: 1,
      lifecycle: 'active',
      revision: 1,
      authority: {
        kind: 'dm',
        lowActorId: 'other',
        highActorId: 'person',
        requestSenderActorId: 'other',
        state: 'pending',
        blocked: false,
        revision: 1,
      },
    };
    assert({
      given:
        'a bounded minor accepting a group invitation and deciding a message request, with every other person, one, or none reachable in an allowed lobby',
      should:
        'restrict unless every person the answer reaches is reachable, and never restrict declining an invitation',
      actual: [
        restricted('channel.invitation.accept', invitation, [
          'inviter',
          'member',
        ]),
        restricted('channel.invitation.accept', invitation, ['inviter']),
        restricted('channel.invitation.accept', invitation, []),
        restricted('channel.invitation.decline', invitation, []),
        restricted('channel.request.decide', request, ['other']),
        restricted('channel.request.decide', request, []),
      ],
      expected: [false, true, true, false, false, true],
    });
    assert({
      given:
        'a bounded minor declining a message request from a person outside the boundary',
      should: 'not restrict the decline',
      actual: reason(
        ask('channel.request.decide', request, {
          account: boundary(['standing']),
          answer: 'decline',
        }),
      ),
      expected: 'missing-capability',
    });
  });
  test('never stops blocking, reporting or ending', () => {
    assert({
      given: 'a bounded minor and a person outside the boundary',
      should: 'never restrict the ways out',
      actual: (
        [
          'social.block',
          'social.report',
          'social.friend.end',
          'social.challenge.decline',
        ] as const
      ).map((capability) => reach(capability, [])),
      expected: [false, false, false, false],
    });
  });
  test('reads only organizations they belong to or whose lobby is allowed', () => {
    assert({
      given:
        'a bounded minor reading the allowed league, another league, their own school, and an adult reading any',
      should: 'allow the first and third, and the adult',
      actual: [
        ask('organization.read', league, { account: boundary(['standing']) })
          .allow,
        ask('organization.read', otherLeague, {
          account: boundary(['standing']),
        }).allow,
        ask(
          'organization.read',
          organization('school', { organizationKind: 'school', member: true }),
          {
            account: boundary(['standing']),
          },
        ).allow,
        ask('organization.read', otherLeague).allow,
        ask(
          'template.read',
          { kind: 'template', organization: otherLeague },
          {
            account: boundary(['standing']),
          },
        ).allow,
      ],
      expected: [true, false, true, true, false],
    });
  });
});
