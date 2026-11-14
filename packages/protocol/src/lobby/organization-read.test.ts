import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  hostHomeViewSchema,
  organizationPeopleViewSchema,
  organizationReadCatalogue,
  organizationViewSchema,
} from './organization-read';

setupRitewayBun();

const id = (name: string) => name.padEnd(24, '0');
const outcome = (schema: Parameters<typeof parseOutcome>[0], input: unknown) => {
  const parsed = parseOutcome(schema, input);
  return 'data' in parsed ? 'ok' : parsed.issues;
};

const lobby = {
  lobbyId: id('autumn'),
  handle: 'autumn-open',
  name: 'Autumn Open',
  kind: 'tournament',
  owner: { organizationId: id('league'), name: 'Southeast League' },
  position: { kind: 'grant', roleName: 'Director' },
  startsAt: '2026-11-14T15:00:00.000Z',
  progress: { status: 'open', setupOpen: 2, entryCount: 31 },
  shape: null,
} as const;
const home = {
  organizations: [
    {
      organizationId: id('league'),
      handle: 'southeast',
      name: 'Southeast League',
      kind: 'league',
      position: { kind: 'owner' },
      schoolCount: 14,
      memberCount: 212,
      sanctionRequestsWaiting: 1,
    },
  ],
  lobbies: [lobby],
  capabilities: { createLobby: true },
};

const profile = {
  organizationId: id('league'),
  handle: 'southeast',
  name: 'Southeast League',
  kind: 'league',
  standingLobby: null,
} as const;
const hostFields = {
  schoolCount: 14,
  memberCount: 212,
  openRoomCount: 9,
  ratedCount: 148,
  capabilities: { manage: true },
};

const owner = {
  userId: id('owner'),
  name: 'Jordan Hale',
  owner: true,
  membership: 'active',
  grants: [],
  conflicts: [],
  removable: false,
} as const;
const people = {
  organizationId: id('league'),
  name: 'Southeast League',
  people: [
    owner,
    {
      ...owner,
      userId: id('dana'),
      name: 'Dana Abara',
      owner: false,
      removable: true,
      grants: [
        {
          grantId: id('grant'),
          roleId: id('role'),
          scope: { kind: 'lobby', lobbyId: id('autumn'), name: 'Autumn Open' },
          expiresAt: '2026-11-15T23:59:00.000Z',
        },
      ],
      conflicts: [
        {
          basis: 'school_entry',
          school: { organizationId: id('hartwell'), name: 'Hartwell' },
          entryCount: 7,
        },
      ],
    },
  ],
  roles: [
    {
      roleId: id('role'),
      name: 'Tab staff',
      rank: 1,
      preset: true,
      permissions: ['tournament.draw.edit'],
    },
  ],
  conflictHandling: { lobbyId: id('autumn'), name: 'Autumn Open', value: 'second_confirms' },
  capabilities: { give: true },
};

describe('organization reads', async () => {
  test('host home', () => {
    assert({
      given: 'host home, a running and a completed tournament, a status the vocabulary lacks, an extra field',
      should: 'accept the first three',
      actual: [
        outcome(hostHomeViewSchema, home),
        outcome(hostHomeViewSchema, {
          ...home,
          lobbies: [
            { ...lobby, progress: { status: 'running', round: { current: 3, of: 4 }, attention: 2 } },
            {
              ...lobby,
              progress: { status: 'completed', certifiedAt: null, countedByLeague: false },
            },
          ],
        }),
        outcome(hostHomeViewSchema, {
          ...home,
          lobbies: [{ ...lobby, progress: { status: 'paused' } }],
        }),
        outcome(hostHomeViewSchema, { ...home, plan: 'league' }),
      ],
      expected: ['ok', 'ok', ['lobbies.0.progress.status'], ['(root)']],
    });
  });

  test('an organization, by audience', () => {
    assert({
      given: 'the public profile, the host variant, and the public profile carrying a host count',
      should: 'accept the variants and refuse a host field on the public one',
      actual: [
        outcome(organizationViewSchema, { audience: 'public', ...profile }),
        outcome(organizationViewSchema, { audience: 'host', ...profile, ...hostFields }),
        outcome(organizationViewSchema, { audience: 'public', ...profile, memberCount: 212 }),
      ],
      expected: ['ok', 'ok', ['(root)']],
    });
  });

  test('people', () => {
    assert({
      given: 'the people view, a removable owner, a permission no role may hold',
      should: 'accept only the first',
      actual: [
        outcome(organizationPeopleViewSchema, people),
        outcome(organizationPeopleViewSchema, {
          ...people,
          people: [{ ...owner, removable: true }],
        }),
        outcome(organizationPeopleViewSchema, {
          ...people,
          roles: [{ ...people.roles[0], permissions: ['room.manage'] }],
        }),
      ],
      expected: ['ok', ['people'], ['roles.0.permissions.0']],
    });
    assert({
      given: 'the catalogue',
      should: 'gate home on a signed-in viewer, the profile on organization.read, people on organization.host.read',
      actual: organizationReadCatalogue,
      expected: {
        HostHomeView: { gate: 'signed-in' },
        OrganizationView: { gate: ['organization.read'] },
        OrganizationPeopleView: { gate: ['organization.host.read'] },
      },
    });
  });
});
