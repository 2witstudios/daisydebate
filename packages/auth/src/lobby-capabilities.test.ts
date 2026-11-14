import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  authorizationCapabilitySchema,
  type AuthorizationCapability,
} from '@daisy/protocol/authorization';
import {
  authorizationResourceKindSchema,
  capabilityMetadata,
} from '@daisy/protocol/capability-metadata';
import type { AuthorizationInput } from './authorization';
import {
  ask,
  fixture,
  hosted,
  league,
  leagueTournament,
  lobbyFact,
  lobbyGrant,
  organization,
  organizationGrant,
  permissionResource,
  permissions,
  school,
  standing,
  type Asker,
} from './lobby.test-support';

setupRitewayBun();

type Resource = AuthorizationInput['resource'];
const reason = (decision: ReturnType<typeof ask>) =>
  decision.allow ? 'allow' : decision.reason;
const teen = { account: { ageBand: '16-17' as const } };
const membership = (
  status: 'invited' | 'active' | 'declined' | 'ended',
): Resource => ({
  kind: 'membership',
  organizationId: 'league',
  actorId: 'person',
  status,
});
const link = (via: typeof school | null = null): Resource => ({
  kind: 'guardian_link',
  guardianActorId: 'person',
  wardActorId: 'ward',
  via,
});
const entry = (
  responsible: Extract<Resource, { kind: 'entry' }>['responsible'],
): Resource => ({ kind: 'entry', scope: hosted, responsible });
const judge: Resource = { kind: 'judge', scope: hosted, actorId: 'person' };
const tabRound = (resolutionReleased: boolean, released = false): Resource => ({
  kind: 'tab_round',
  scope: hosted,
  resolutionReleased,
  viewing: {
    audiences: ['participants'],
    releases: released ? [{ thing: 'posting', audience: 'participants' }] : [],
  },
});
const creation = (
  proposed: Extract<Resource, { kind: 'lobby_collection' }>['proposed'],
): Resource => ({ kind: 'lobby_collection', proposed });
const sanction: Resource = { kind: 'sanction', league, scope: hosted };
const rosterManager: Asker = {
  grants: [organizationGrant('school', ['school.roster.manage'])],
};
const entriesManager: Asker = {
  grants: [lobbyGrant('hosted', ['tournament.entries.manage'])],
};

describe('organizations and memberships', () => {
  test('are created by adults, a league on the hosting plan', () => {
    const create = (proposedKind: 'league' | 'school', asker: Asker = {}) =>
      reason(
        ask(
          'organization.create',
          { kind: 'organization_collection', proposedKind },
          asker,
        ),
      );
    assert({
      given: 'an adult, an adult on the hosting plan, and a 16 year old on it',
      should: 'let any adult make a school and only the plan holder a league',
      actual: [
        create('school'),
        create('league'),
        create('league', { account: { hostingPlan: true } }),
        create('school', { account: { ageBand: '16-17', hostingPlan: true } }),
      ],
      expected: ['allow', 'missing-capability', 'allow', 'age-band'],
    });
  });
  test('membership grants nothing', () => {
    const member = organization('league', { member: true });
    assert({
      given: 'an active member with no grant',
      should:
        'read the organization and hold no host view, permission or transfer',
      actual: (
        [
          'organization.read',
          'organization.host.read',
          'organization.manage',
          'organization.owner.transfer',
          'action_history.read',
        ] as const
      ).map((capability) => reason(ask(capability, member))),
      expected: [
        'allow',
        'missing-capability',
        'missing-capability',
        'missing-capability',
        'missing-capability',
      ],
    });
    assert({
      given: 'the owner, and a person with any live grant',
      should: 'give both the host view and only the owner the transfer',
      actual: [
        ask('organization.host.read', league, { actorId: 'league-owner' }),
        ask('organization.owner.transfer', league, { actorId: 'league-owner' })
          .allow,
        ask('organization.host.read', league, {
          grants: [organizationGrant('league', [])],
        }).allow,
        ask('organization.owner.transfer', league, {
          grants: [organizationGrant('league', permissions)],
        }).allow,
      ],
      expected: [
        {
          allow: true,
          authority: {
            kind: 'owner',
            of: { kind: 'organization', organizationId: 'league' },
          },
          conflict: null,
        },
        true,
        true,
        false,
      ],
    });
  });
  test('an invitation is answered and a membership left only by its own person', () => {
    assert({
      given: 'each membership status, asked by the member and by someone else',
      should: 'let the invited respond and the active leave, nobody else',
      actual: (['invited', 'active', 'declined', 'ended'] as const).map(
        (status) => [
          ask('organization.membership.respond', membership(status)).allow,
          ask('organization.membership.leave', membership(status)).allow,
          ask('organization.membership.respond', membership(status), {
            actorId: 'other',
          }).allow,
          ask('organization.membership.leave', membership(status), {
            actorId: 'other',
          }).allow,
        ],
      ),
      expected: [
        [true, false, false, false],
        [false, true, false, false],
        [false, false, false, false],
        [false, false, false, false],
      ],
    });
  });
});

describe('guardian links', () => {
  test('are a relationship an adult makes, or a school’s roster manager', () => {
    assert({
      given:
        'the adult guardian, a minor as guardian, a stranger, and a link through a school',
      should: 'allow the adult guardian, the roster manager, and nobody else',
      actual: [
        ask('guardian.link.create', link()),
        reason(ask('guardian.link.create', link(), teen)),
        reason(ask('guardian.link.create', link(), { actorId: 'other' })),
        reason(ask('guardian.link.create', link(school), {})),
        reason(ask('guardian.link.create', link(school), rosterManager)),
        reason(
          ask('guardian.link.create', link(school), {
            ...rosterManager,
            ...teen,
          }),
        ),
      ],
      expected: [
        {
          allow: true,
          authority: { kind: 'relationship', relation: 'guardian' },
          conflict: null,
        },
        'age-band',
        'missing-capability',
        'missing-capability',
        'allow',
        'age-band',
      ],
    });
  });
  test('are managed by the guardian and read by guardian and ward', () => {
    assert({
      given: 'the guardian, the ward and a stranger',
      should: 'let the guardian manage, and both read',
      actual: ['person', 'ward', 'other'].map((actorId) =>
        (['guardian.link.manage', 'guardian.link.read'] as const).map(
          (capability) =>
            ask(capability, link(), {
              actorId,
              account: { ageBand: actorId === 'ward' ? '16-17' : 'adult' },
            }).allow,
        ),
      ),
      expected: [
        [true, true],
        [false, true],
        [false, false],
      ],
    });
  });
});

describe('lobbies', () => {
  test('one create serves both kinds, each with its own authority', () => {
    const leagueOwner = { kind: 'organization' as const, organization: league };
    const schoolOwner = { kind: 'organization' as const, organization: school };
    assert({
      given:
        'a tournament for a person, for a league, for a school, and a standing lobby',
      should:
        'take the hosting plan, setup at the league, never a school, and organization management',
      actual: [
        reason(
          ask(
            'lobby.create',
            creation({ lobbyKind: 'tournament', owner: { kind: 'person' } }),
          ),
        ),
        reason(
          ask(
            'lobby.create',
            creation({ lobbyKind: 'tournament', owner: { kind: 'person' } }),
            { account: { hostingPlan: true } },
          ),
        ),
        reason(
          ask(
            'lobby.create',
            creation({ lobbyKind: 'tournament', owner: leagueOwner }),
            { account: { hostingPlan: true } },
          ),
        ),
        reason(
          ask(
            'lobby.create',
            creation({ lobbyKind: 'tournament', owner: leagueOwner }),
            { grants: [organizationGrant('league', ['lobby.setup.manage'])] },
          ),
        ),
        reason(
          ask(
            'lobby.create',
            creation({ lobbyKind: 'tournament', owner: schoolOwner }),
            { actorId: 'school-owner' },
          ),
        ),
        reason(
          ask(
            'lobby.create',
            creation({ lobbyKind: 'standing', owner: leagueOwner }),
            { grants: [organizationGrant('league', ['lobby.setup.manage'])] },
          ),
        ),
        reason(
          ask(
            'lobby.create',
            creation({ lobbyKind: 'standing', owner: leagueOwner }),
            { grants: [organizationGrant('league', ['organization.manage'])] },
          ),
        ),
        reason(
          ask(
            'lobby.create',
            creation({ lobbyKind: 'standing', owner: leagueOwner }),
            { actorId: 'league-owner', account: { ageBand: '16-17' } },
          ),
        ),
      ],
      expected: [
        'missing-capability',
        'allow',
        'missing-capability',
        'allow',
        'denied',
        'missing-capability',
        'allow',
        'age-band',
      ],
    });
  });
  test('a Room is made in a standing lobby by its participants', () => {
    const participant = {
      viewing: { audiences: ['participants' as const], releases: [] },
    };
    assert({
      given:
        'a participant and a non-participant of a standing lobby, and a participant of a tournament',
      should:
        'allow the first, refuse the second, and call the third the wrong kind',
      actual: [
        reason(ask('lobby.room.create', lobbyFact(standing, participant))),
        reason(ask('lobby.room.create', lobbyFact(standing))),
        reason(ask('lobby.room.create', lobbyFact(hosted, participant))),
      ],
      expected: ['allow', 'missing-capability', 'denied'],
    });
  });
  test('the host view is the owner’s and any grant holder’s', () => {
    assert({
      given:
        'the owner, a holder of any grant at the lobby or its league, a stranger, and a 16 year old with a grant where staff must be adult and where 16 is enough',
      should:
        'allow all but the stranger and the grant holder below the staff band',
      actual: [
        ask('lobby.host.read', lobbyFact(hosted), { actorId: 'host' }).allow,
        ask('lobby.host.read', lobbyFact(hosted), {
          grants: [lobbyGrant('hosted', [])],
        }).allow,
        ask('lobby.host.read', lobbyFact(leagueTournament), {
          grants: [organizationGrant('league', [])],
        }).allow,
        ask('lobby.host.read', lobbyFact(hosted)).allow,
        ask('lobby.host.read', lobbyFact(hosted), {
          ...teen,
          grants: [lobbyGrant('hosted', [])],
        }).allow,
        ask('lobby.host.read', lobbyFact(hosted), {
          ...teen,
          grants: [lobbyGrant('hosted', [], { staffMinimumBand: '16-17' })],
        }).allow,
      ],
      expected: [true, true, true, false, false, true],
    });
  });
});

describe('entries and judges', () => {
  test('an entry is its responsible adult’s, and tab staff’s', () => {
    const responsibles = [
      { kind: 'school' as const, school },
      { kind: 'guardian' as const, guardianActorId: 'person' },
      { kind: 'self' as const, actorId: 'person' },
    ];
    const answers = (asker: Asker) =>
      responsibles.map((responsible) =>
        (['entry.submit', 'entry.withdraw', 'entry.read'] as const).map(
          (capability) => reason(ask(capability, entry(responsible), asker)),
        ),
      );
    const each = (answer: string) => [answer, answer, answer];
    assert({
      given:
        'entries answered for by a school, a guardian and the entrant, asked by five people',
      should:
        'allow the school’s roster manager, the guardian, the adult entrant and entries staff',
      actual: {
        rosterManager: answers(rosterManager),
        person: answers({}),
        teen: answers(teen),
        stranger: answers({ actorId: 'other' }),
        staff: answers({ actorId: 'other', ...entriesManager }),
      },
      expected: {
        rosterManager: [each('allow'), each('allow'), each('allow')],
        person: [each('missing-capability'), each('allow'), each('allow')],
        teen: [each('missing-capability'), each('age-band'), each('age-band')],
        stranger: [
          each('missing-capability'),
          each('missing-capability'),
          each('missing-capability'),
        ],
        staff: [each('allow'), each('allow'), each('allow')],
      },
    });
  });
  test('a judge answers their own invitation; staff may set availability', () => {
    assert({
      given: 'the judge, entries staff and a stranger',
      should: 'let the judge do both and staff only the availability',
      actual: [
        {},
        { actorId: 'other', ...entriesManager },
        { actorId: 'other' },
      ].map((asker) =>
        (
          ['judge.invitation.respond', 'judge.availability.update'] as const
        ).map((capability) => ask(capability, judge, asker).allow),
      ),
      expected: [
        [true, true],
        [false, true],
        [false, false],
      ],
    });
  });
});

describe('resolutions and sanctions', () => {
  test('a resolution is read with the posting once released, and by permission before', () => {
    const early: Asker = {
      grants: [
        lobbyGrant('hosted', ['tournament.resolutions.read_unreleased']),
      ],
    };
    assert({
      given:
        'a participant and a holder of the unreleased permission, before release, after it with no posting, and with the posting open',
      should:
        'show the participant only the released resolution of an open posting, and the holder always',
      actual: [
        tabRound(false, true),
        tabRound(true, false),
        tabRound(true, true),
      ].map((resource) => [
        ask('resolution.read', resource).allow,
        ask('resolution.read', resource, early).allow,
      ]),
      expected: [
        [false, true],
        [false, true],
        [true, true],
      ],
    });
  });
  test('a sanction is read by either side’s host readers', () => {
    assert({
      given: 'the league’s owner, the tournament’s staff and a stranger',
      should: 'allow the first two',
      actual: [
        ask('sanction.read', sanction, { actorId: 'league-owner' }).allow,
        ask('sanction.read', sanction, { grants: [lobbyGrant('hosted', [])] })
          .allow,
        ask('sanction.read', sanction).allow,
      ],
      expected: [true, true, false],
    });
  });
});

describe('the whole list', () => {
  const pending: Resource = {
    kind: 'pending_command',
    proposerActorId: 'proposer',
    capability: 'tournament.results.enter',
    target: fixture(hosted),
  };
  const participant = { audiences: ['participants' as const], releases: [] };
  const open = (thing: 'posting' | 'decision') => ({
    audiences: ['participants' as const],
    releases: [{ thing, audience: 'participants' as const }],
  });
  /** For each derived capability, someone it allows. */
  const witnesses: Partial<
    Record<AuthorizationCapability, readonly [Resource, Asker]>
  > = {
    'organization.create': [
      { kind: 'organization_collection', proposedKind: 'school' },
      {},
    ],
    'organization.read': [league, {}],
    'organization.host.read': [league, { actorId: 'league-owner' }],
    'organization.membership.respond': [membership('invited'), {}],
    'organization.membership.leave': [membership('active'), {}],
    'organization.owner.transfer': [league, { actorId: 'league-owner' }],
    'guardian.link.create': [link(), {}],
    'guardian.link.manage': [link(), {}],
    'guardian.link.read': [link(), { actorId: 'ward' }],
    'lobby.create': [
      creation({ lobbyKind: 'tournament', owner: { kind: 'person' } }),
      { account: { hostingPlan: true } },
    ],
    'lobby.read': [
      lobbyFact(hosted, {
        postingAudiences: ['participants'],
        viewing: participant,
      }),
      {},
    ],
    'lobby.host.read': [lobbyFact(hosted), { actorId: 'host' }],
    'lobby.room.create': [lobbyFact(standing, { viewing: participant }), {}],
    'template.read': [{ kind: 'template', organization: league }, {}],
    'entry.submit': [entry({ kind: 'self', actorId: 'person' }), {}],
    'entry.withdraw': [entry({ kind: 'self', actorId: 'person' }), {}],
    'entry.read': [entry({ kind: 'self', actorId: 'person' }), {}],
    'judge.invitation.respond': [judge, {}],
    'judge.availability.update': [judge, {}],
    'posting.read': [
      { kind: 'draw', scope: hosted, viewing: open('posting') },
      {},
    ],
    'result.read': [fixture(hosted, { viewing: open('decision') }), {}],
    'ballot.read': [
      {
        kind: 'ballot',
        scope: hosted,
        conflict: fixture(hosted).conflict,
        viewing: open('decision'),
        part: 'decision',
      },
      {},
    ],
    'standings.read': [lobbyFact(hosted, { viewing: open('decision') }), {}],
    'resolution.read': [tabRound(true, true), {}],
    'command.confirm': [
      pending,
      { grants: [lobbyGrant('hosted', ['tournament.results.enter'])] },
    ],
    'command.withdraw': [pending, { actorId: 'proposer' }],
    'sanction.read': [sanction, { actorId: 'league-owner' }],
  };
  const added = authorizationCapabilitySchema.options.slice(
    authorizationCapabilitySchema.options.indexOf('organization.manage'),
  );
  test('the evaluator answers every capability added for lobbies', () => {
    assert({
      given: 'the permissions and the capabilities with a witness below',
      should: 'be every capability added, with nothing left undecided',
      actual: [...permissions, ...Object.keys(witnesses)].sort(),
      expected: [...added].sort(),
    });
    assert({
      given: 'each derived capability asked by the person its rule names',
      should: 'allow every one',
      actual: Object.entries(witnesses)
        .filter(
          ([capability, [resource, asker]]) =>
            !ask(capability as AuthorizationCapability, resource, asker).allow,
        )
        .map(([capability]) => capability),
      expected: [],
    });
    assert({
      given:
        'each permission on each resource kind it names, asked by the owner of the lobby or organization',
      should: 'allow every one',
      actual: permissions.flatMap((permission) =>
        capabilityMetadata[permission].resourceKinds
          .filter((kind) => {
            const owner = permission.startsWith('school.') ? school : league;
            const actorId = permission.startsWith('school.')
              ? 'school-owner'
              : 'league-owner';
            return !ask(
              permission,
              permissionResource(kind, leagueTournament, owner),
              { actorId },
            ).allow;
          })
          .map((kind) => `${permission} on ${kind}`),
      ),
      expected: [],
    });
  });
  test('no capability is allowed outside its resource kinds', () => {
    const kinds = authorizationResourceKindSchema.options;
    const all = authorizationCapabilitySchema.options;
    assert({
      given:
        'every capability asked of every resource kind it does not name, by an owner',
      should: 'deny each as the wrong kind',
      actual: all.flatMap((capability) =>
        kinds
          .filter(
            (kind) =>
              !capabilityMetadata[capability].resourceKinds.includes(kind),
          )
          .filter(
            (kind) =>
              reason(
                ask(capability, { kind } as Resource, {
                  actorId: 'league-owner',
                }),
              ) !== 'denied',
          )
          .map((kind) => `${capability} on ${kind}`),
      ),
      expected: [],
    });
  });
  test('an erased account is refused everything', () => {
    assert({
      given:
        'every witness above and every permission, asked by an owner whose account is erased',
      should: 'deny each as erased',
      actual: [
        ...Object.entries(witnesses).map(([capability, [resource, asker]]) =>
          reason(
            ask(capability as AuthorizationCapability, resource, {
              ...asker,
              account: { ...asker.account, erased: true },
            }),
          ),
        ),
        ...permissions.map((permission) =>
          reason(
            ask(
              permission,
              permissionResource(
                capabilityMetadata[permission].resourceKinds[0]!,
                leagueTournament,
                permission.startsWith('school.') ? school : league,
              ),
              { actorId: 'league-owner', account: { erased: true } },
            ),
          ),
        ),
      ].filter((answer) => answer !== 'account-erased'),
      expected: [],
    });
  });
  test('an allowed decision names what it was allowed under', () => {
    assert({
      given: 'a fixed rule, an owner, a grant and a relationship',
      should: 'name each',
      actual: [
        ask('room.create', { kind: 'room_collection' }),
        ask('lobby.announce', lobbyFact(hosted), { actorId: 'host' }),
        ask('lobby.announce', lobbyFact(hosted), {
          grants: [lobbyGrant('hosted', ['lobby.announce'])],
        }),
        ask('judge.invitation.respond', judge),
      ].map((decision) => decision.allow && decision.authority),
      expected: [
        { kind: 'fixed' },
        { kind: 'owner', of: { kind: 'lobby', lobbyId: 'hosted' } },
        { kind: 'grant', grantId: 'grant-1' },
        { kind: 'relationship', relation: 'self' },
      ],
    });
  });
});
