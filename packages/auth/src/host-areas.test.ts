import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  AuthorizationCapability,
  Permission,
} from '@daisy/protocol/authorization';
import { authorizedHostAreas, type GrantFact } from './authorization';
import {
  ask,
  hosted,
  league,
  leagueTournament,
  standing,
  organizationGrant,
  NOW,
  lobbyFact,
  lobbyGrant,
  permissions,
} from './lobby.test-support';

setupRitewayBun();

// The specification is independent of the production metadata.
const areas = [
  [
    'lobby.host.draw.read',
    [
      'tournament.draw.edit',
      'tournament.draw.publish',
      'tournament.rooms.officiate',
    ],
  ],
  ['lobby.host.entries.read', ['tournament.entries.manage']],
  ['lobby.host.ballots.read', ['tournament.ballots.read_unreleased']],
  [
    'lobby.host.results.read',
    ['tournament.results.enter', 'tournament.results.release'],
  ],
  ['lobby.host.recordings.read', ['tournament.rooms.officiate']],
  ['lobby.host.people.read', ['organization.roles.manage']],
  ['action_history.read', ['action_history.read']],
] as const;
const reads = areas.map(
  ([capability]) => capability as AuthorizationCapability,
);
const visible = (held: readonly Permission[]) => {
  const asker = { grants: [lobbyGrant('hosted', held)] };
  return reads.filter(
    (capability) => ask(capability, lobbyFact(hosted), asker).allow,
  );
};
const subsets = () =>
  Array.from({ length: 2 ** permissions.length }, (_, mask) =>
    permissions.filter((_, index) => (mask & (1 << index)) !== 0),
  );

describe('host area permission properties', () => {
  test('a grant whose role holds no permission in an area cannot read that area', () => {
    const failures = subsets().flatMap((held) => {
      const actual = visible(held);
      const expected = areas
        .filter(([, required]) =>
          required.some((permission) => held.includes(permission)),
        )
        .map(([capability]) => capability);
      return JSON.stringify(actual) === JSON.stringify(expected)
        ? []
        : [{ held, actual, expected }];
    });
    assert({
      given: 'every subset of the fifteen permissions in a live covering grant',
      should: 'read exactly the areas for which it holds a permission',
      actual: failures.slice(0, 3),
      expected: [],
    });
  });

  test('a preset Tab Director reads every area', () => {
    assert({
      given: 'the complete existing Tab Director permission bundle',
      should: 'read every area through the existing permissions',
      actual: visible(permissions),
      expected: reads,
    });
    assert({
      given: 'the owner without a grant',
      should: 'read all seven areas including recordings',
      actual: reads.filter(
        (capability) =>
          ask(capability, lobbyFact(hosted), { actorId: 'host' }).allow,
      ),
      expected: reads,
    });
  });

  test('a ballot-reviewer role reads ballots and nothing else in the host area', () => {
    assert({
      given: 'a ballot-only grant',
      should: 'open the shell and read ballots only',
      actual: {
        shell: ask('lobby.host.read', lobbyFact(hosted), {
          grants: [
            lobbyGrant('hosted', ['tournament.ballots.read_unreleased']),
          ],
        }).allow,
        areas: visible(['tournament.ballots.read_unreleased']),
      },
      expected: { shell: true, areas: ['lobby.host.ballots.read'] },
    });
  });

  test('adding a permission never removes an area', () => {
    const sets = subsets();
    const seen = sets.map(visible);
    const failures = sets.flatMap((held, mask) =>
      permissions.flatMap((permission, bit) => {
        if (held.includes(permission)) return [];
        const missing = seen[mask]!.filter(
          (area) => !seen[mask | (1 << bit)]!.includes(area),
        );
        return missing.length === 0 ? [] : [{ held, permission, missing }];
      }),
    );
    assert({
      given: 'every permission subset and every single-permission extension',
      should: 'retain every already visible area',
      actual: failures.slice(0, 3),
      expected: [],
    });
  });
});

describe('host area authority boundaries', () => {
  test('only usable covering grants open an area', () => {
    const permission = ['tournament.ballots.read_unreleased'] as const;
    const cases = [
      lobbyGrant('hosted', permission),
      lobbyGrant('other', permission),
      lobbyGrant('hosted', permission, { membershipActive: false }),
      lobbyGrant('hosted', permission, { revision: 0 }),
      lobbyGrant('hosted', permission, {
        expiresAt: '2026-11-13T12:00:00.000Z',
      }),
      lobbyGrant('hosted', permission, { expiresAt: 'invalid' }),
    ];
    assert({
      given:
        'live, wrong-scope, ended, invalid-revision, expired and malformed-expiry grants',
      should: 'allow only the usable covering ballot permission',
      actual: cases.map(
        (grant) =>
          ask('lobby.host.ballots.read', lobbyFact(hosted), { grants: [grant] })
            .allow,
      ),
      expected: [true, false, false, false, false, false],
    });
    assert({
      given: 'a usable empty grant beside an unusable ballot grant',
      should:
        'open the shell without lending usability to the ballot permission',
      actual: ask('lobby.host.ballots.read', lobbyFact(hosted), {
        grants: [
          lobbyGrant('hosted', []),
          lobbyGrant('hosted', permission, { membershipActive: false }),
        ],
      }).allow,
      expected: false,
    });
  });

  test('age limits ownership and each permission-bearing grant', () => {
    assert({
      given: 'a teen owner, adult-only staff grant and teen-usable staff grant',
      should: 'allow only the staff grant that admits their band',
      actual: [
        ask('lobby.host.draw.read', lobbyFact(hosted), {
          actorId: 'host',
          account: { ageBand: '16-17' },
        }).allow,
        ask('lobby.host.draw.read', lobbyFact(hosted), {
          account: { ageBand: '16-17' },
          grants: [lobbyGrant('hosted', ['tournament.draw.edit'])],
        }).allow,
        ask('lobby.host.draw.read', lobbyFact(hosted), {
          account: { ageBand: '16-17' },
          grants: [
            lobbyGrant('hosted', ['tournament.draw.edit'], {
              staffMinimumBand: '16-17',
            }),
          ],
        }).allow,
      ],
      expected: [false, false, true],
    });
  });

  test('an unrelated grant cannot read sanctions', () => {
    const sanction = { kind: 'sanction' as const, league, scope: hosted };
    assert({
      given:
        'an empty grant, a ballot-only grant, lobby setup staff and league managers',
      should: 'allow only the two setup authorities',
      actual: [
        { grants: [lobbyGrant('hosted', [])] },
        {
          grants: [
            lobbyGrant('hosted', ['tournament.ballots.read_unreleased']),
          ],
        },
        { grants: [lobbyGrant('hosted', ['lobby.setup.manage'])] },
        { grants: [organizationGrant('league', ['organization.manage'])] },
      ].map((asker) => ask('sanction.read', sanction, asker).allow),
      expected: [false, false, true, true],
    });
  });

  test('organization grants cover only their own lobbies', () => {
    const asker = {
      grants: [organizationGrant('league', ['tournament.draw.publish'])],
    };
    assert({
      given: 'a league-level draw permission',
      should:
        'open its tournament draw but neither a personal tournament nor another area',
      actual: [
        ask('lobby.host.draw.read', lobbyFact(leagueTournament), asker).allow,
        ask('lobby.host.draw.read', lobbyFact(hosted), asker).allow,
        ask('lobby.host.results.read', lobbyFact(leagueTournament), asker)
          .allow,
      ],
      expected: [true, false, false],
    });
  });
});

describe('authorizedHostAreas', () => {
  const input = (grants: readonly GrantFact[] = [], actorId = 'person') => ({
    principal: { kind: 'user' as const, userId: actorId, actorId },
    resource: lobbyFact(hosted),
    context: {
      account: {
        userId: actorId,
        actorId,
        member: true,
        erased: false,
        revision: 1,
        beta: { state: 'approved' as const, revision: 1 },
        ageBand: 'adult' as const,
        restricted: false,
      },
      grants,
      now: NOW,
    },
  });

  test('returns the evaluator’s allowed area reads for the rail', () => {
    assert({
      given: 'a stranger, an empty grant, a ballot reviewer and the owner',
      should:
        'report no areas, no areas, ballots only, and all areas respectively',
      actual: [
        authorizedHostAreas(input()),
        authorizedHostAreas(input([lobbyGrant('hosted', [])])),
        authorizedHostAreas(
          input([lobbyGrant('hosted', ['tournament.ballots.read_unreleased'])]),
        ),
        [...authorizedHostAreas(input([], 'host'))].sort(),
      ],
      expected: [[], [], ['lobby.host.ballots.read'], [...reads].sort()],
    });
  });

  test('does not bypass membership or a minor’s lobby boundary', () => {
    const base = input([
      lobbyGrant('hosted', permissions, { staffMinimumBand: '16-17' }),
    ]);
    assert({
      given:
        'a member who is erased, unadmitted, or outside their guardian boundary',
      should: 'report no host areas',
      actual: [
        { ...base.context.account, erased: true },
        { ...base.context.account, member: false },
        {
          ...base.context.account,
          ageBand: '16-17' as const,
          boundary: { allowedLobbyIds: [], entryLobbyIds: [], revision: 1 },
        },
      ].map((account) =>
        authorizedHostAreas({ ...base, context: { ...base.context, account } }),
      ),
      expected: [[], [], []],
    });
  });

  test('supports organization and standing lobby people and history without tournament areas', () => {
    const base = input([
      organizationGrant('league', [
        'organization.roles.manage',
        'action_history.read',
      ]),
    ]);
    assert({
      given: 'people and history staff at a league',
      should: 'see those two areas on the league and its standing lobby',
      actual: [league, lobbyFact(standing)].map((resource) =>
        [...authorizedHostAreas({ ...base, resource })].sort(),
      ),
      expected: [
        ['action_history.read', 'lobby.host.people.read'],
        ['action_history.read', 'lobby.host.people.read'],
      ],
    });
  });
});
