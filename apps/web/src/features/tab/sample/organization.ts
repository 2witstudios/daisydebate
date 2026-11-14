import type {
  HostHomeView,
  HostLobby,
  OrganizationPeopleView,
  OrganizationRole,
} from '@daisy/protocol/lobby/organization-read';
import type { Permission } from '@daisy/protocol/lobby';
import { hostRoutes } from '../routes';
import { AUTUMN, LEAGUE, LEAGUE_NAME, reached, SCRIMMAGE, WINTER } from './moment';
import type { SampleScene } from './scene';

/** A sample's stable identifier, shaped as a real one: 24 of `[a-z0-9]`. */
export const sampleId = (name: string): string =>
  name.toLowerCase().replaceAll(/[^a-z0-9]/g, '').padEnd(24, '0').slice(0, 24);

/** The instant every host sample reads as now: the day of Autumn Open. */
export const sampleNow = '2026-11-14T21:00:00.000Z';
export const sampleViewerId = sampleId('viewer');

export const sampleIds = {
  league: sampleId('league'),
  leagueLobby: sampleId('leaguelobby'),
  autumn: sampleId('autumnopen'),
  winter: sampleId('winterclassic'),
  scrimmage: sampleId('fridayscrimmage'),
  opener: sampleId('septemberopener'),
  ridgeview: sampleId('ridgeviewinvitational'),
  championship: sampleId('championship'),
  ridgeviewSchool: sampleId('ridgeviewschool'),
  hartwell: sampleId('hartwellschool'),
  varsityTemplate: sampleId('varsitytemplate'),
} as const;

/** Host pages exist for the tournaments the sample draws in depth. */
export const sampleHostAddress = (lobby: {
  readonly handle: string;
}): string | null =>
  lobby.handle === AUTUMN || lobby.handle === WINTER
    ? hostRoutes.tournament(lobby.handle)
    : null;

const league = { organizationId: sampleIds.league, name: LEAGUE_NAME };

function autumnLobby(scene: SampleScene): HostLobby {
  const progress: HostLobby['progress'] = reached(scene, 'finished')
    ? {
        status: 'completed',
        certifiedAt: '2026-11-14T20:30:00.000Z',
        countedByLeague: true,
      }
    : reached(scene, 'prelims')
      ? { status: 'running', round: { current: 3, of: 4 }, attention: 2 }
      : { status: 'open', setupOpen: 2, entryCount: 31 };
  return {
    lobbyId: sampleIds.autumn,
    handle: AUTUMN,
    name: 'Autumn Open',
    kind: 'tournament',
    owner: league,
    position: { kind: 'grant', roleName: 'Director' },
    startsAt: '2026-11-14T15:00:00.000Z',
    progress,
    shape: null,
  };
}

export function sampleHostHomeView(scene: SampleScene): HostHomeView {
  return {
    organizations: [
      {
        organizationId: sampleIds.league,
        handle: LEAGUE,
        name: LEAGUE_NAME,
        kind: 'league',
        position: { kind: 'owner' },
        schoolCount: 14,
        memberCount: 212,
        sanctionRequestsWaiting: 1,
      },
    ],
    lobbies: [
      autumnLobby(scene),
      {
        lobbyId: sampleIds.scrimmage,
        handle: SCRIMMAGE,
        name: 'Friday scrimmage',
        kind: 'tournament',
        owner: null,
        position: { kind: 'owner' },
        startsAt: '2026-11-20T23:00:00.000Z',
        progress: { status: 'open', setupOpen: 0, entryCount: 9 },
        shape: {
          approval: 'automatic',
          cap: 16,
          stages: ['elimination'],
          seeding: 'rating',
        },
      },
      {
        lobbyId: sampleIds.winter,
        handle: WINTER,
        name: 'Winter Classic',
        kind: 'tournament',
        owner: league,
        position: { kind: 'grant', roleName: 'Tab staff' },
        startsAt: '2026-12-12T14:00:00.000Z',
        progress: { status: 'draft' },
        shape: null,
      },
      {
        lobbyId: sampleIds.opener,
        handle: 'september-opener',
        name: 'September Opener',
        kind: 'tournament',
        owner: league,
        position: { kind: 'grant', roleName: 'Director' },
        startsAt: '2026-09-19T14:00:00.000Z',
        progress: {
          status: 'completed',
          certifiedAt: '2026-09-19T21:00:00.000Z',
          countedByLeague: true,
        },
        shape: null,
      },
    ],
    capabilities: { createLobby: true },
  };
}

const role = (
  name: string,
  rank: number,
  permissions: readonly Permission[],
): OrganizationRole => ({
  roleId: sampleId(`role${name}`),
  name,
  rank,
  preset: true,
  permissions: [...permissions],
});

/** Tab staff's permissions; a Director adds the rest of running a tournament. */
const tabStaff: readonly Permission[] = [
  'tournament.draw.edit',
  'tournament.rooms.officiate',
  'tournament.results.enter',
  'tournament.ballots.read_unreleased',
  'tournament.entries.manage',
  'lobby.announce',
];
const roles = {
  director: role('Director', 0, [
    ...tabStaff,
    'tournament.draw.publish',
    'tournament.results.release',
    'tournament.resolutions.read_unreleased',
    'lobby.setup.manage',
    'organization.roles.manage',
  ]),
  tabStaff: role('Tab staff', 1, tabStaff),
  topicCommittee: role('Topic committee', 2, [
    'tournament.resolutions.read_unreleased',
  ]),
  roomHelper: role('Room helper', 3, [
    'tournament.rooms.officiate',
    'lobby.announce',
  ]),
} as const;

const autumnScope = {
  kind: 'lobby',
  lobbyId: sampleIds.autumn,
  name: 'Autumn Open',
} as const;
/** Tournament staff grants end the day after the tournament. */
const endsSunday = '2026-11-15T23:59:00.000Z';

export function samplePeopleView(_scene: SampleScene): OrganizationPeopleView {
  const grant = (
    who: string,
    held: OrganizationRole,
    scope: OrganizationPeopleView['people'][number]['grants'][number]['scope'],
    expiresAt: string | null = null,
  ) => ({ grantId: sampleId(`grant${who}`), roleId: held.roleId, scope, expiresAt });
  const member = (
    name: string,
    grants: OrganizationPeopleView['people'][number]['grants'],
    membership: 'active' | 'invited' = 'active',
  ) => ({
    userId: sampleId(name),
    name,
    owner: false,
    membership,
    grants,
    conflicts: [],
    removable: membership === 'active',
  });
  return {
    organizationId: sampleIds.league,
    name: LEAGUE_NAME,
    people: [
      {
        userId: sampleViewerId,
        name: 'Jordan Hale',
        owner: true,
        membership: 'active',
        grants: [],
        conflicts: [],
        removable: false,
      },
      member('Priya Lindqvist', [
        grant('priya', roles.director, { kind: 'organization' }),
      ]),
      {
        ...member('Dana Abara', [
          grant('dana', roles.tabStaff, autumnScope, endsSunday),
        ]),
        conflicts: [
          {
            basis: 'school_entry',
            school: { organizationId: sampleIds.hartwell, name: 'Hartwell' },
            entryCount: 7,
          },
        ],
      },
      member('Sam Reyes', [grant('sam', roles.tabStaff, autumnScope, endsSunday)]),
      member('Lena Cho', [
        grant('lena', roles.topicCommittee, { kind: 'organization' }),
      ]),
      member(
        'Marcus Bello',
        [grant('marcus', roles.roomHelper, autumnScope)],
        'invited',
      ),
    ],
    roles: Object.values(roles),
    conflictHandling: {
      lobbyId: sampleIds.autumn,
      name: 'Autumn Open',
      value: 'second_confirms',
    },
    capabilities: { give: true },
  };
}
