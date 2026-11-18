import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { GuardianCommand } from '@daisy/protocol/lobby/guardian-command';
import {
  decideGuardian,
  type GuardianFacts,
  type GuardianLinkRow,
} from './guardian';

setupRitewayBun();

const now = '2026-11-14T12:00:00.000Z';
const link: GuardianLinkRow = {
  id: 'link',
  guardianUserId: 'parent',
  minorUserId: 'ward',
  kind: 'parent',
  viaOrganizationId: null,
  status: 'active',
  version: 3,
};
const facts = (overrides: Partial<GuardianFacts> = {}): GuardianFacts => ({
  now,
  newId: 'new',
  link,
  wardAgeBand: '13-15',
  guardianAgeBand: 'adult',
  guardianSchoolMembership: null,
  openLinkExists: false,
  wardOtherActiveLinks: 1,
  consentNoticeVersion: 2,
  lobbies: [
    { id: 'league-lobby', closedAt: null },
    { id: 'old-lobby', closedAt: now },
  ],
  restriction: null,
  ...overrides,
});
const refusalOf = (given: GuardianFacts, command: GuardianCommand) => {
  const decision = decideGuardian(given, command);
  return decision.kind === 'refused' ? decision.refusal : 'accepted';
};
const writesOf = (given: GuardianFacts, command: GuardianCommand) => {
  const decision = decideGuardian(given, command);
  return decision.kind === 'accepted' ? decision.writes : decision.refusal;
};
const bumpWard = {
  table: 'users',
  op: 'update',
  id: 'ward',
  increment: 'version',
} as const;

describe('decideGuardian', () => {
  const create = {
    type: 'create-guardian-link',
    guardianUserId: 'coach',
    wardUserId: 'ward',
    through: { kind: 'school', organizationId: 'school' },
  } as const;

  test('creating a link', () => {
    assert({
      given: 'a direct link, and one through a school naming an active member',
      should:
        'make a pending parent link, or a pending coach link through the school',
      actual: [
        decideGuardian(facts({ link: null }), {
          ...create,
          guardianUserId: 'parent',
          through: { kind: 'direct' },
        }),
        writesOf(
          facts({ link: null, guardianSchoolMembership: 'active' }),
          create,
        ),
      ],
      expected: [
        {
          kind: 'accepted',
          aggregate: { kind: 'guardian_link', id: 'new' },
          resultingVersion: 1,
          writes: [
            {
              table: 'guardian_links',
              op: 'insert',
              row: {
                id: 'new',
                guardianUserId: 'parent',
                minorUserId: 'ward',
                kind: 'parent',
                viaOrganizationId: null,
                status: 'pending',
              },
            },
          ],
          findings: [],
          fixtureChanges: [],
        },
        [
          {
            table: 'guardian_links',
            op: 'insert',
            row: {
              id: 'new',
              guardianUserId: 'coach',
              minorUserId: 'ward',
              kind: 'coach',
              viaOrganizationId: 'school',
              status: 'pending',
            },
          },
        ],
      ],
    });
    assert({
      given:
        'an adult ward, an unknown-age ward, a guardian who is not adult, an adult not in the school, and an open link',
      should: 'refuse each with its name',
      actual: [
        refusalOf(
          facts({
            link: null,
            wardAgeBand: 'adult',
            guardianSchoolMembership: 'active',
          }),
          create,
        ),
        refusalOf(
          facts({
            link: null,
            wardAgeBand: null,
            guardianSchoolMembership: 'active',
          }),
          create,
        ),
        refusalOf(
          facts({
            link: null,
            guardianAgeBand: '16-17',
            guardianSchoolMembership: 'active',
          }),
          create,
        ),
        refusalOf(
          facts({ link: null, guardianSchoolMembership: 'invited' }),
          create,
        ),
        refusalOf(
          facts({
            link: null,
            guardianSchoolMembership: 'active',
            openLinkExists: true,
          }),
          create,
        ),
      ],
      expected: [
        'ward-not-minor',
        'ward-not-minor',
        'guardian-not-adult',
        'guardian-not-member',
        'link-exists',
      ],
    });
  });

  test('consent', () => {
    const consent = {
      type: 'consent-guardian-link',
      guardianLinkId: 'link',
      noticeVersion: 2,
    } as const;
    const pending = facts({ link: { ...link, status: 'pending' } });
    assert({
      given: 'consent under the notice in force',
      should: 'make the link active and move the ward’s revision',
      actual: writesOf(pending, consent),
      expected: [
        {
          table: 'guardian_links',
          op: 'update',
          id: 'link',
          set: { status: 'active', version: 4 },
        },
        bumpWard,
      ],
    });
    assert({
      given: 'a link already active, a notice since changed, and another link',
      should: 'refuse link-not-pending, notice-changed and not-found',
      actual: [
        refusalOf(facts(), consent),
        refusalOf(pending, { ...consent, noticeVersion: 1 }),
        refusalOf(pending, { ...consent, guardianLinkId: 'other' }),
      ],
      expected: ['link-not-pending', 'notice-changed', 'not-found'],
    });
  });

  test('adding a guardian', () => {
    const add = {
      type: 'add-guardian',
      guardianLinkId: 'link',
      guardianUserId: 'second',
    } as const;
    assert({
      given: 'an active parent link and a second adult',
      should: 'make a pending parent link for the same ward',
      actual: writesOf(facts(), add),
      expected: [
        {
          table: 'guardian_links',
          op: 'insert',
          row: {
            id: 'new',
            guardianUserId: 'second',
            minorUserId: 'ward',
            kind: 'parent',
            viaOrganizationId: null,
            status: 'pending',
          },
        },
      ],
    });
    assert({
      given:
        'a pending link, a coach link, a second person not adult, and one already linked',
      should: 'refuse each with its name',
      actual: [
        refusalOf(facts({ link: { ...link, status: 'pending' } }), add),
        refusalOf(
          facts({
            link: { ...link, kind: 'coach', viaOrganizationId: 'school' },
          }),
          add,
        ),
        refusalOf(facts({ guardianAgeBand: '16-17' }), add),
        refusalOf(facts({ openLinkExists: true }), add),
      ],
      expected: [
        'link-not-active',
        'not-a-parent',
        'guardian-not-adult',
        'link-exists',
      ],
    });
  });

  test('setting a restriction', () => {
    const restrict: GuardianCommand = {
      type: 'set-restriction',
      guardianLinkId: 'link',
      limitsLobbies: true,
      allowedLobbyIds: ['league-lobby'],
      videoCap: 'officials',
    };
    const people = {
      guardianLinkId: 'link',
      guardianUserId: 'parent',
      minorUserId: 'ward',
    };
    assert({
      given: 'a first restriction',
      should:
        'insert it with its lobbies, move the link version and the ward’s revision',
      actual: decideGuardian(facts(), restrict),
      expected: {
        kind: 'accepted',
        aggregate: { kind: 'guardian_link', id: 'link' },
        resultingVersion: 4,
        writes: [
          {
            table: 'guardian_links',
            op: 'update',
            id: 'link',
            set: { version: 4 },
          },
          {
            table: 'restrictions',
            op: 'insert',
            row: {
              ...people,
              limitsLobbies: true,
              videoAudienceCap: 'officials',
            },
          },
          {
            table: 'restriction_lobbies',
            op: 'insert',
            row: { ...people, lobbyId: 'league-lobby' },
          },
          bumpWard,
        ],
        findings: [],
        fixtureChanges: [],
      },
    });
    assert({
      given: 'a change to an existing restriction',
      should: 'update it and change only the lobbies that differ',
      actual: writesOf(
        facts({
          restriction: {
            limitsLobbies: true,
            videoAudienceCap: 'lobby',
            version: 2,
            lobbyIds: ['old-lobby'],
          },
        }),
        restrict,
      ),
      expected: [
        {
          table: 'guardian_links',
          op: 'update',
          id: 'link',
          set: { version: 4 },
        },
        {
          table: 'restrictions',
          op: 'update',
          guardianLinkId: 'link',
          set: {
            limitsLobbies: true,
            videoAudienceCap: 'officials',
            version: 3,
          },
        },
        {
          table: 'restriction_lobbies',
          op: 'delete',
          guardianLinkId: 'link',
          lobbyId: 'old-lobby',
        },
        {
          table: 'restriction_lobbies',
          op: 'insert',
          row: { ...people, lobbyId: 'league-lobby' },
        },
        bumpWard,
      ],
    });
    assert({
      given:
        'a pending link, a coach link, a closed lobby and an unknown lobby',
      should: 'refuse link-not-active, not-a-parent and lobby-unavailable',
      actual: [
        refusalOf(facts({ link: { ...link, status: 'pending' } }), restrict),
        refusalOf(
          facts({
            link: { ...link, kind: 'coach', viaOrganizationId: 'school' },
          }),
          restrict,
        ),
        refusalOf(facts(), { ...restrict, allowedLobbyIds: ['old-lobby'] }),
        refusalOf(facts(), { ...restrict, allowedLobbyIds: ['nowhere'] }),
      ],
      expected: [
        'link-not-active',
        'not-a-parent',
        'lobby-unavailable',
        'lobby-unavailable',
      ],
    });
  });

  test('ending a link', () => {
    const end = { type: 'end-guardian-link', guardianLinkId: 'link' } as const;
    assert({
      given: 'a link beside another active one, holding a restriction',
      should: 'end it, remove its restriction and move the ward’s revision',
      actual: writesOf(
        facts({
          restriction: {
            limitsLobbies: false,
            videoAudienceCap: 'lobby',
            version: 1,
            lobbyIds: [],
          },
        }),
        end,
      ),
      expected: [
        {
          table: 'guardian_links',
          op: 'update',
          id: 'link',
          set: { status: 'ended', endedAt: now, version: 4 },
        },
        { table: 'restrictions', op: 'delete', guardianLinkId: 'link' },
        bumpWard,
      ],
    });
    assert({
      given:
        'a minor’s only active link, an ended link, and the only link of a ward now adult',
      should: 'refuse last-guardian and link-ended, and accept the last',
      actual: [
        refusalOf(facts({ wardOtherActiveLinks: 0 }), end),
        refusalOf(facts({ link: { ...link, status: 'ended' } }), end),
        refusalOf(
          facts({ wardOtherActiveLinks: 0, wardAgeBand: 'adult' }),
          end,
        ),
      ],
      expected: ['last-guardian', 'link-ended', 'accepted'],
    });
  });
});
