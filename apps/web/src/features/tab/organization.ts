import type {
  HostHomeView,
  HostLobby,
  OrganizationPeopleView,
  OrganizationPerson,
  OrganizationRole,
} from '@daisy/protocol/lobby/organization-read';
import type { Permission } from '@daisy/protocol/lobby';
import { linkTo, sampleAction, type TabAction } from './action';
import { hostRoutes } from './routes';
import {
  sampleHostHomeView,
  sampleHostAddress,
  sampleNow,
  samplePeopleView,
  sampleViewerId,
} from './sample/organization';
import type { RailItem, TimelineRail } from './tournament';
import type { SampleScene } from './sample/scene';

export type HostTournamentRow = {
  readonly name: string;
  readonly owner: string;
  readonly detail: string;
  readonly action: TabAction;
};

/** Everything the viewer holds a grant on. */
export type HostHome = {
  readonly create: TabAction;
  readonly groups: readonly {
    readonly heading: string;
    readonly tournaments: readonly HostTournamentRow[];
  }[];
  readonly cards: readonly {
    readonly title: string;
    readonly detail: string;
    readonly action: TabAction;
  }[];
};

/** A member with the grants they hold, or the owner's fixed position. */
export type PersonRow = {
  readonly name: string;
  readonly detail: string;
  /** A conflict the evaluator has recorded for this person. */
  readonly conflict: string | null;
  readonly owner: boolean;
  readonly action: TabAction | null;
};

/** One of Daisy's preset roles: a named set of permissions. */
export type PresetRole = {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly selected: boolean;
};

export type People = {
  readonly give: TabAction;
  readonly people: readonly PersonRow[];
  readonly roles: readonly PresetRole[];
  readonly role: {
    readonly name: string;
    readonly permissions: readonly {
      readonly label: string;
      readonly allowed: boolean;
    }[];
    readonly conflictRule: string;
  };
};

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'June',
  'July',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
] as const;
const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const DAY_MS = 86_400_000;
const dayIndex = (instant: string) => Math.floor(Date.parse(instant) / DAY_MS);

/** A UTC day as host screens word it: `14 Nov`. */
export const dayWords = (instant: string): string => {
  const date = new Date(instant);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()] ?? ''}`;
};
/** A month as host screens word it: `March`. */
export const monthWords = (month: string): string =>
  new Date(`${month}-01T00:00:00.000Z`).toLocaleString('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  });
export const isSameDay = (a: string, b: string): boolean =>
  dayIndex(a) === dayIndex(b);
/** Whole days from one instant's day back to another's. */
export const daysBefore = (earlier: string, now: string): number =>
  dayIndex(now) - dayIndex(earlier);
/** A day within the coming week by its weekday, a later one by its date. */
const comingDayWords = (instant: string, now: string): string =>
  daysBefore(now, instant) < 7
    ? (weekdays[new Date(instant).getUTCDay()] ?? '')
    : dayWords(instant);

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
const joined = (parts: readonly (string | null)[]) =>
  parts.filter((part): part is string => part !== null).join(' · ');

const positionWords = (lobby: HostLobby): string | null =>
  lobby.position.kind === 'grant' ? `you are ${lobby.position.roleName}` : null;

const shapeWords = (shape: NonNullable<HostLobby['shape']>): string => {
  const elimination = shape.stages.every((stage) => stage === 'elimination');
  return [
    shape.approval === 'automatic' ? 'open entry' : 'entry approved by you',
    shape.cap === null ? null : `${shape.cap} places`,
    `${elimination ? 'single elimination' : 'prelims, then elimination'} seeded by ${shape.seeding === 'rating' ? 'Daisy rating' : 'standings'}`,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
};

/** What a host-home row says about where a tournament stands. */
function lobbyDetail(lobby: HostLobby, now: string): string {
  const day = lobby.startsAt === null ? null : dayWords(lobby.startsAt);
  const progress = lobby.progress;
  if (progress === null) return joined([day, positionWords(lobby)]);
  switch (progress.status) {
    case 'draft':
      return joined([
        day,
        'setup not finished',
        'entries not open',
        positionWords(lobby),
      ]);
    case 'open':
      return joined([
        day,
        progress.setupOpen > 0
          ? `setup has ${progress.setupOpen} to finish`
          : null,
        lobby.shape === null ? null : shapeWords(lobby.shape),
        `${progress.entryCount} entered`,
        positionWords(lobby),
      ]);
    case 'running':
      return joined([
        `Round ${progress.round.current} of ${progress.round.of}`,
        progress.attention === 1
          ? '1 thing needs you'
          : `${progress.attention} things need you`,
        positionWords(lobby),
      ]);
    case 'completed':
      return joined([
        progress.certifiedAt === null
          ? 'Not yet certified'
          : `Certified ${isSameDay(progress.certifiedAt, now) ? 'today' : dayWords(progress.certifiedAt)}`,
        progress.countedByLeague ? 'results sent to the league' : null,
      ]);
    case 'cancelled':
      return joined([day, 'cancelled']);
  }
}

const isFinished = (lobby: HostLobby) =>
  lobby.progress?.status === 'completed' ||
  lobby.progress?.status === 'cancelled';
const isUnderway = (lobby: HostLobby, now: string) =>
  !isFinished(lobby) &&
  (lobby.progress?.status === 'running' ||
    (lobby.startsAt !== null && isSameDay(lobby.startsAt, now)));
const byStart = (a: HostLobby, b: HostLobby) =>
  (a.startsAt ?? '').localeCompare(b.startsAt ?? '');

/** Where a lobby's host pages are, or null while it has none. */
export type HostAddress = (lobby: { readonly handle: string }) => string | null;

const open = (
  label: string,
  address: string | null,
  primary = false,
): TabAction =>
  address === null
    ? sampleAction(label, primary)
    : linkTo(label, address, primary);

/** Host home from the viewer's host-home read. */
export function hostHomeOf(
  view: HostHomeView,
  now: string,
  addressOf: HostAddress,
): HostHome {
  const tournaments = view.lobbies.filter(
    (lobby) => lobby.kind === 'tournament',
  );
  const row = (lobby: HostLobby): HostTournamentRow => ({
    name: lobby.name,
    owner: lobby.owner?.name ?? 'hosted by you',
    detail: lobbyDetail(lobby, now),
    action: isFinished(lobby)
      ? open('Results', addressOf(lobby))
      : open('Open', addressOf(lobby), isUnderway(lobby, now)),
  });
  const running = tournaments.filter(
    (lobby) => lobby.progress?.status === 'running',
  );
  const coming = tournaments
    .filter((lobby) => !isFinished(lobby) && !running.includes(lobby))
    .sort(byStart);
  const finished = tournaments.filter(isFinished).sort((a, b) => byStart(b, a));
  const owned = view.organizations.find(
    (organization) => organization.position.kind === 'owner',
  );
  return {
    create: sampleAction('New tournament', true),
    groups: [
      ...(running.length === 0
        ? []
        : [{ heading: 'Running now', tournaments: running.map(row) }]),
      { heading: 'Coming up', tournaments: coming.map(row) },
      { heading: 'Finished', tournaments: finished.map(row) },
    ],
    cards: [
      ...view.organizations.map((organization) => ({
        title: organization.name,
        detail: [
          organization.position.kind === 'owner'
            ? 'You own it.'
            : `You are ${organization.position.roleName}.`,
          `${plural(organization.schoolCount, 'school', 'schools')}, ${plural(organization.memberCount, 'member', 'members')}.`,
          organization.sanctionRequestsWaiting === 0
            ? null
            : organization.sanctionRequestsWaiting === 1
              ? '1 sanction request is waiting.'
              : `${organization.sanctionRequestsWaiting} sanction requests are waiting.`,
        ]
          .filter((part): part is string => part !== null)
          .join(' '),
        action: linkTo(
          `Open the ${organization.kind}`,
          hostRoutes.league(organization.handle),
        ),
      })),
      // Billing is not a lobby read: the plan card names the league it bills.
      ...(owned
        ? [
            {
              title: 'Hosting plan',
              detail: `League plan, paid by ${owned.name}. Covers the league's tournaments and the ones you host yourself.`,
              action: sampleAction('Manage plan'),
            },
          ]
        : []),
    ],
  };
}

/** Host home's rail: tournaments from today on, then the leagues the viewer runs. */
export function hostRailOf(
  view: HostHomeView,
  now: string,
  addressOf: HostAddress,
): TimelineRail {
  const items = view.lobbies
    .filter(
      (lobby) =>
        lobby.kind === 'tournament' &&
        lobby.startsAt !== null &&
        daysBefore(lobby.startsAt, now) <= 0,
    )
    .sort(byStart)
    .map((lobby): RailItem => ({
      id: lobby.handle,
      label: lobby.name,
      time: null,
      standing: isFinished(lobby)
        ? { kind: 'done' }
        : {
            kind: 'note',
            text:
              lobby.startsAt !== null && isSameDay(lobby.startsAt, now)
                ? 'today'
                : dayWords(lobby.startsAt ?? now),
          },
      action: open(lobby.name, addressOf(lobby)),
    }));
  return {
    title: 'Host',
    subtitle: null,
    heading: 'Coming up',
    items,
    footHeading: 'Leagues',
    foot: view.organizations
      .filter((organization) => organization.kind === 'league')
      .map((organization) => ({
        id: organization.handle,
        label: organization.name,
        time: null,
        standing: null,
        action: linkTo(
          organization.name,
          hostRoutes.league(organization.handle),
        ),
      })),
  };
}

/** The permissions the people page lists, in its order, as it words them. */
const permissionWords: readonly (readonly [Permission, string])[] = [
  ['tournament.draw.edit', 'Change a draft draw'],
  [
    'tournament.rooms.officiate',
    'Run rooms: reseat, replace a judge, restart, forfeit',
  ],
  ['tournament.results.enter', 'Enter and correct results'],
  ['tournament.ballots.read_unreleased', 'See ballots before release'],
  ['tournament.entries.manage', 'Manage entries and judges'],
  ['lobby.announce', 'Message participants'],
  ['tournament.draw.publish', 'Publish a draw'],
  ['tournament.results.release', 'Release and certify results'],
  ['tournament.resolutions.read_unreleased', 'See resolutions before release'],
  ['lobby.setup.manage', 'Change tournament setup'],
  ['organization.roles.manage', 'Manage roles and people'],
  ['organization.manage', 'Manage the league'],
];

const handlingWords = {
  denied: 'they are refused',
  second_confirms: 'a second person confirms',
  flagged: 'it goes ahead, flagged',
} as const;

/** A role's place in a page address: its name, lowercased and hyphenated. */
const roleSlug = (role: OrganizationRole) =>
  role.name.trim().toLowerCase().replaceAll(/\s+/g, '-');

/** The role held by the most grants, the highest of those that tie. */
const mostHeld = (view: OrganizationPeopleView) => {
  const held = (role: OrganizationRole) =>
    view.people
      .flatMap((person) => person.grants)
      .filter((grant) => grant.roleId === role.roleId).length;
  return [...view.roles].sort(
    (a, b) => held(b) - held(a) || a.rank - b.rank,
  )[0];
};

/** An organization's people page from its people read. */
export function peopleOf(
  view: OrganizationPeopleView,
  context: {
    readonly role: string | null;
    readonly basePath: string;
    readonly viewerId: string;
    readonly now: string;
  },
): People {
  const roles = view.roles
    .filter((role) => role.preset)
    .sort((a, b) => a.rank - b.rank);
  const chosen =
    roles.find((role) => roleSlug(role) === context.role) ?? mostHeld(view);
  const roleName = (roleId: string) =>
    view.roles.find((role) => role.roleId === roleId)?.name ?? '';
  const person = (member: OrganizationPerson): PersonRow => {
    const grants = member.grants.map((grant) =>
      joined([
        member.membership === 'invited'
          ? `Invited as ${roleName(grant.roleId)}`
          : roleName(grant.roleId),
        grant.scope.kind === 'organization'
          ? 'whole league'
          : `${grant.scope.name} only`,
        grant.expiresAt === null
          ? null
          : `ends ${comingDayWords(grant.expiresAt, context.now)}`,
        member.membership === 'invited' ? 'not yet accepted' : null,
      ]),
    );
    return {
      name: member.userId === context.viewerId ? 'You' : member.name,
      detail: member.owner
        ? `Owner of ${view.name} · can't be removed by anyone else`
        : grants.join(' · '),
      conflict:
        member.conflicts
          .map((conflict) =>
            conflict.basis === 'school_entry' && conflict.school
              ? `Coaches at ${conflict.school.name}, which has ${conflict.entryCount} entries here`
              : null,
          )
          .find((words) => words !== null) ?? null,
      owner: member.owner,
      action: member.owner
        ? null
        : member.membership === 'invited'
          ? sampleAction('Cancel invite')
          : member.removable
            ? sampleAction('Change')
            : null,
    };
  };
  const allowed = new Set(chosen?.permissions ?? []);
  return {
    give: sampleAction('Give someone a role', true),
    people: view.people.map(person),
    roles: roles.map((role) => ({
      id: roleSlug(role),
      name: role.name,
      href: `${context.basePath}?role=${roleSlug(role)}`,
      selected: role.roleId === chosen?.roleId,
    })),
    role: {
      name: chosen?.name ?? '',
      permissions: permissionWords.map(([permission, label]) => ({
        label,
        allowed: allowed.has(permission),
      })),
      conflictRule: [
        "Whatever a role allows, anyone connected to a room is handled by that tournament's setting.",
        view.conflictHandling === null
          ? null
          : `At ${view.conflictHandling.name} ${handlingWords[view.conflictHandling.value]}.`,
      ]
        .filter((part): part is string => part !== null)
        .join(' '),
    },
  };
}

export const readHostHome = (scene: SampleScene): HostHome =>
  hostHomeOf(sampleHostHomeView(scene), sampleNow, sampleHostAddress);

export const readPeople = (
  role: string | null,
  basePath: string,
  scene: SampleScene,
): People =>
  peopleOf(samplePeopleView(scene), {
    role,
    basePath,
    viewerId: sampleViewerId,
    now: sampleNow,
  });

export const readHostRail = (scene: SampleScene): TimelineRail =>
  hostRailOf(sampleHostHomeView(scene), sampleNow, sampleHostAddress);
