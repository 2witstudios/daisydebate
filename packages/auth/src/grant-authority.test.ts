import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Permission } from '@daisy/protocol/authorization';
import { validResourceKind } from './authorization-resource-kind';
import {
  ask,
  hosted,
  league,
  leagueTournament,
  lobbyFact,
  lobbyGrant,
  organization,
  organizationGrant,
  permissionQuestions,
  permissions,
  school,
  scopes,
  standing,
  type Asker,
} from './lobby.test-support';

setupRitewayBun();

const lobbyPermissions = permissions.filter(
  (permission) => !permission.startsWith('school.'),
);
const questions = [
  ...scopes.flatMap((scope) => permissionQuestions(scope, league)),
  ...permissionQuestions(hosted, school),
].filter(({ permission, resource }) => validResourceKind(permission, resource));
const answers = (asker: Asker) =>
  questions.map(
    ({ permission, resource }) => ask(permission, resource, asker).allow,
  );
const count = (values: readonly boolean[]) => values.filter(Boolean).length;

describe('grants and ownership', () => {
  test('no grant, no authority', () => {
    assert({
      given: 'a member of every organization with no grant and no ownership',
      should: 'be denied every permission on every resource',
      actual: questions
        .map((question) => ask(question.permission, question.resource))
        .filter(
          (decision) =>
            decision.allow || decision.reason !== 'missing-capability',
        ).length,
      expected: 0,
    });
  });

  test('an owner holds every permission without a grant', () => {
    const lobbyQuestions = (scope: typeof hosted) =>
      permissionQuestions(scope, league).filter(
        ({ permission, resource }) =>
          resource.kind !== 'organization' &&
          resource.kind !== 'template' &&
          validResourceKind(permission, resource),
      );
    assert({
      given:
        'the person who owns a tournament, and the owner of the league that owns one',
      should: 'allow every permission that applies there, under ownership',
      actual: [
        lobbyQuestions(hosted).map(({ permission, resource }) =>
          ask(permission, resource, { actorId: 'host' }),
        ),
        lobbyQuestions(leagueTournament).map(({ permission, resource }) =>
          ask(permission, resource, { actorId: 'league-owner' }),
        ),
      ].map((decisions) =>
        decisions.every(
          (decision) => decision.allow && decision.authority.kind === 'owner',
        ),
      ),
      expected: [true, true],
    });
    assert({
      given: 'the owner of one tournament asking at another lobby',
      should: 'hold nothing there',
      actual: count(
        lobbyQuestions(leagueTournament).map(
          ({ permission, resource }) =>
            ask(permission, resource, { actorId: 'host' }).allow,
        ),
      ),
      expected: 0,
    });
  });

  test('a covering grant allows exactly its permissions', () => {
    const one: Permission = 'tournament.draw.publish';
    const grants = [lobbyGrant('hosted', [one])];
    assert({
      given: 'a grant of one permission at one lobby',
      should: 'allow that permission on that lobby and nothing else anywhere',
      actual: [
        ...new Set(
          questions
            .filter(
              ({ permission, resource }) =>
                ask(permission, resource, { grants }).allow,
            )
            .map(
              ({ permission, resource }) =>
                `${permission} at ${'scope' in resource ? resource.scope.lobbyId : 'organization'}`,
            ),
        ),
      ],
      expected: ['tournament.draw.publish at hosted'],
    });
    assert({
      given: 'a grant of every lobby permission at the owning organization',
      should:
        'cover the organization and each lobby it owns, and no other lobby',
      actual: ['standing', 'league-tournament', 'hosted'].map((lobbyId) =>
        scopes
          .filter((scope) => scope.lobbyId === lobbyId)
          .flatMap((scope) => permissionQuestions(scope, league))
          .filter(
            ({ permission, resource }) =>
              'scope' in resource && validResourceKind(permission, resource),
          )
          .every(
            ({ permission, resource }) =>
              ask(permission, resource, {
                grants: [organizationGrant('league', lobbyPermissions)],
              }).allow,
          ),
      ),
      expected: [true, true, false],
    });
  });

  test('a grant elsewhere changes nothing here', () => {
    assert({
      given:
        'every permission granted at another lobby and another organization',
      should: 'decide every question exactly as with no grant',
      actual: answers({
        grants: [
          lobbyGrant('elsewhere', permissions),
          organizationGrant('another-league', permissions),
        ],
      }),
      expected: answers({}),
    });
  });

  test('an expired grant, an ended membership and a dead grant equal no grant', () => {
    const everywhere = (over: Parameters<typeof lobbyGrant>[2]) => [
      ...scopes.map((scope) => lobbyGrant(scope.lobbyId, permissions, over)),
      organizationGrant('league', permissions, over),
      organizationGrant('school', permissions, over),
    ];
    assert({
      given:
        'grants of every permission everywhere that are live, expired, without a clock, without a membership, or without a revision',
      should: 'count only the live ones',
      actual: [
        count(answers({ grants: everywhere({}) })) === questions.length,
        count(
          answers({
            grants: everywhere({ expiresAt: '2026-11-13T12:00:00.000Z' }),
          }),
        ),
        count(
          answers({
            grants: everywhere({ expiresAt: '2026-11-13T12:00:00.001Z' }),
          }),
        ) === questions.length,
        count(answers({ grants: everywhere({ membershipActive: false }) })),
        count(answers({ grants: everywhere({ revision: 0 }) })),
      ],
      expected: [true, 0, true, 0, 0],
    });
  });

  test('adding a grant never turns an allow into a deny', () => {
    const pool = [
      lobbyGrant('hosted', ['tournament.draw.edit'], { grantId: 'a' }),
      lobbyGrant('standing', ['lobby.announce'], { grantId: 'b' }),
      organizationGrant('league', lobbyPermissions, { grantId: 'c' }),
      organizationGrant('school', permissions, { grantId: 'd' }),
      lobbyGrant('hosted', permissions, {
        grantId: 'e',
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    ];
    const subsets = Array.from({ length: 2 ** pool.length }, (_, bits) =>
      pool.filter((_grant, index) => (bits >> index) & 1),
    );
    assert({
      given: 'every subset of a pool of grants, and each grant added to it',
      should: 'never lose an allow',
      actual: subsets.flatMap((grants) =>
        pool.flatMap((added) => {
          const before = answers({ grants });
          const after = answers({ grants: [...grants, added] });
          return before.filter((allow, index) => allow && !after[index]);
        }),
      ).length,
      expected: 0,
    });
  });

  test('a school permission is held only through that school', () => {
    const roster: Permission = 'school.roster.manage';
    assert({
      given:
        'a school permission granted at the school, at a lobby, at a league, and at another school',
      should:
        'be held only by the grant at that school, and be the wrong kind of question for a league',
      actual: [
        ask(roster, school, { grants: [organizationGrant('school', [roster])] })
          .allow,
        ask(roster, school, { grants: [lobbyGrant('hosted', [roster])] }).allow,
        ask(roster, school, {
          grants: [organizationGrant('other-school', [roster])],
        }).allow,
        ask(roster, school, { actorId: 'school-owner' }).allow,
        ask(roster, league, {
          grants: [organizationGrant('league', [roster])],
        }),
      ],
      expected: [
        true,
        false,
        false,
        true,
        { allow: false, reason: 'denied', conflict: null },
      ],
    });
  });

  test('a tournament permission asked of a standing lobby is the wrong kind', () => {
    assert({
      given:
        'the owner of a standing lobby asked a tournament permission there, and a lobby permission',
      should: 'deny the first as the wrong kind and allow the second',
      actual: [
        ask('tournament.entries.manage', lobbyFact(standing), {
          actorId: 'league-owner',
        }),
        ask('lobby.announce', lobbyFact(standing), { actorId: 'league-owner' })
          .allow,
      ],
      expected: [{ allow: false, reason: 'denied', conflict: null }, true],
    });
  });

  test('the authority named is the narrowest grant, then the lowest id', () => {
    const publish: Permission = 'tournament.draw.publish';
    const draw = permissionQuestions(leagueTournament, league).find(
      ({ permission }) => permission === publish,
    )!.resource;
    const grants = [
      organizationGrant('league', [publish], { grantId: 'a-organization' }),
      lobbyGrant('league-tournament', [publish], { grantId: 'z-lobby' }),
      lobbyGrant('league-tournament', [publish], { grantId: 'm-lobby' }),
    ];
    assert({
      given: 'three grants that all allow, in either order',
      should: 'name the lobby grant with the lowest id both times',
      actual: [grants, [...grants].reverse()].map((order) =>
        ask(publish, draw, { grants: order }),
      ),
      expected: Array(2).fill({
        allow: true,
        authority: { kind: 'grant', grantId: 'm-lobby' },
        conflict: null,
      }),
    });
  });

  test('a permission needs the band the granting organization sets', () => {
    const announce = (
      ageBand: '16-17' | 'adult',
      staffMinimumBand: '16-17' | 'adult',
    ) =>
      ask('lobby.announce', lobbyFact(hosted), {
        account: { ageBand },
        grants: [
          lobbyGrant('hosted', ['lobby.announce'], { staffMinimumBand }),
        ],
      });
    assert({
      given:
        'a 16 or 17 year old with a grant, where staff must be adult and where 16 is enough',
      should: 'deny for the age band in the first and allow in the second',
      actual: [
        announce('16-17', 'adult'),
        announce('16-17', '16-17').allow,
        announce('adult', 'adult').allow,
        ask('school.roster.manage', school, {
          account: { ageBand: '16-17' },
          grants: [
            organizationGrant('school', ['school.roster.manage'], {
              staffMinimumBand: '16-17',
            }),
          ],
        }),
      ],
      expected: [
        { allow: false, reason: 'age-band', conflict: null },
        true,
        true,
        { allow: false, reason: 'age-band', conflict: null },
      ],
    });
  });
});

describe('giving a role', () => {
  const target = lobbyFact(hosted);
  const give = (
    grants: Asker['grants'],
    roleGiven: Asker['roleGiven'],
    actorId = 'person',
  ) =>
    ask('organization.roles.manage', target, { actorId, grants, roleGiven })
      .allow;
  const manager = (extra: readonly Permission[], roleRank: number) => [
    lobbyGrant('hosted', ['organization.roles.manage', ...extra], { roleRank }),
  ];
  test('nobody gives a permission they lack or a role at or above their own', () => {
    assert({
      given: 'a role manager of rank 5 who also holds draw editing',
      should: 'give a lower role of permissions they hold, and nothing else',
      actual: [
        give(manager(['tournament.draw.edit'], 5), {
          permissions: ['tournament.draw.edit'],
          roleRank: 4,
        }),
        give(manager(['tournament.draw.edit'], 5), {
          permissions: ['tournament.draw.publish'],
          roleRank: 4,
        }),
        give(manager(['tournament.draw.edit'], 5), {
          permissions: ['tournament.draw.edit'],
          roleRank: 5,
        }),
        give(manager(['tournament.draw.edit'], 5), {
          permissions: ['school.roster.manage'],
          roleRank: 1,
        }),
        give(manager([], 5), { permissions: [], roleRank: 1 }),
        give(
          [lobbyGrant('hosted', ['tournament.draw.edit'], { roleRank: 9 })],
          { permissions: [], roleRank: 1 },
        ),
      ],
      expected: [true, false, false, false, true, false],
    });
  });
  test('a school permission is never given at a lobby or a league', () => {
    const everything = { roleRank: 9 };
    const role = {
      permissions: ['school.roster.manage' as const],
      roleRank: 1,
    };
    const giveAt = (
      resource: Parameters<typeof ask>[1],
      grants: Asker['grants'],
    ) =>
      ask('organization.roles.manage', resource, { grants, roleGiven: role })
        .allow;
    assert({
      given:
        'a role manager whose grant lists a school permission, at a lobby, at a league and at the school',
      should: 'give it only at the school, where alone it is held',
      actual: [
        giveAt(target, [lobbyGrant('hosted', permissions, everything)]),
        giveAt(league, [organizationGrant('league', permissions, everything)]),
        giveAt(school, [organizationGrant('school', permissions, everything)]),
      ],
      expected: [false, false, true],
    });
  });
  test('an owner outranks every role, and a role must be named', () => {
    assert({
      given:
        'the owner giving the most senior role, a manager asked without a role, and with the role left out',
      should:
        'allow the owner, answer whether the manager manages roles, and refuse the incomplete question',
      actual: [
        give([], { permissions: lobbyPermissions, roleRank: 99 }, 'host'),
        give(manager([], 1), null),
        ask('organization.roles.manage', target, {
          grants: manager([], 1),
          roleGiven: 'omitted',
        }),
      ],
      expected: [
        true,
        true,
        { allow: false, reason: 'denied', conflict: null },
      ],
    });
  });
  test('no chain of gifts yields a permission the first giver lacks', () => {
    const held: readonly Permission[] = [
      'organization.roles.manage',
      'lobby.announce',
    ];
    const roles = lobbyPermissions.flatMap((permission) =>
      [1, 2, 3].map((roleRank) => ({
        permissions: [permission, 'organization.roles.manage' as const],
        roleRank,
      })),
    );
    const reach = (
      grants: NonNullable<Asker['grants']>,
      depth: number,
    ): readonly Permission[] =>
      depth === 0
        ? grants.flatMap((held) => held.permissions)
        : roles
            .filter((role) => give(grants, role))
            .flatMap((role) =>
              reach(
                [
                  lobbyGrant('hosted', role.permissions, {
                    roleRank: role.roleRank,
                  }),
                ],
                depth - 1,
              ),
            );
    assert({
      given:
        'a giver of rank 3, and everyone their gifts could reach in three steps',
      should: 'never hold a permission the first giver lacked',
      actual: [1, 2, 3]
        .flatMap((depth) =>
          reach([lobbyGrant('hosted', held, { roleRank: 3 })], depth),
        )
        .filter((permission) => !held.includes(permission)),
      expected: [],
    });
  });
  test('organization and lobby both take the rule', () => {
    assert({
      given:
        'a role manager at the league giving at the league and at its tournament',
      should: 'give at both, and at no lobby the league does not own',
      actual: [
        organization('league'),
        lobbyFact(leagueTournament),
        lobbyFact(hosted),
      ].map(
        (resource) =>
          ask('organization.roles.manage', resource, {
            grants: [
              organizationGrant('league', ['organization.roles.manage'], {
                roleRank: 2,
              }),
            ],
            roleGiven: { permissions: [], roleRank: 1 },
          }).allow,
      ),
      expected: [true, true, false],
    });
  });
});
