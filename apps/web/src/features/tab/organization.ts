import type { People, PersonRow } from './people';
import {
  peopleRoleOf,
  peopleRoleSlug as roleSlug,
  peopleRoleSelection,
} from './people-role';
import type {
  HostHomeView,
  HostLobby,
  OrganizationPeopleView,
  OrganizationPerson,
} from '@daisy/protocol/lobby/organization-read';
import { linkTo, unavailableAction, type TabAction } from './action';
import { hostRoutes } from './routes';
import type { RailItem, TimelineRail } from './tournament';

type HostTournamentRow = {
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
type HostAddress = (lobby: { readonly handle: string }) => string | null;

const open = (
  label: string,
  address: string | null,
  primary = false,
): TabAction =>
  address === null
    ? unavailableAction(label, primary)
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
    create: unavailableAction('New tournament', true),
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
              action: unavailableAction('Manage plan'),
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

const handlingWords = {
  denied: 'they are refused',
  second_confirms: 'a second person confirms',
  flagged: 'it goes ahead, flagged',
} as const;

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
  const { roles, chosen } = peopleRoleSelection(
    view.roles,
    view.people.flatMap((person) => person.grants.map((grant) => grant.roleId)),
    context.role,
  );
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
      id: member.userId,
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
          ? unavailableAction('Cancel invite')
          : member.removable
            ? unavailableAction('Change')
            : null,
    };
  };
  return {
    give: unavailableAction('Give someone a role', true),
    people: view.people.map(person),
    roles: roles.map((role) => ({
      id: roleSlug(role),
      name: role.name,
      href: `${context.basePath}?role=${roleSlug(role)}`,
      selected: role.roleId === chosen?.roleId,
    })),
    role: peopleRoleOf(
      chosen ?? null,
      [
        "Whatever a role allows, anyone connected to a room is handled by that tournament's setting.",
        view.conflictHandling === null
          ? null
          : `At ${view.conflictHandling.name} ${handlingWords[view.conflictHandling.value]}.`,
      ]
        .filter((part): part is string => part !== null)
        .join(' '),
    ),
  };
}

/** An organization's people page from its stored people read. */
export const organizationPeoplePage = (
  view: OrganizationPeopleView,
  context: {
    readonly role: string | null;
    readonly basePath: string;
    readonly viewerId: string;
    readonly now: string;
  },
): People => peopleOf(view, context);

/**
 * The rail beside a stored organization's people page: the organization by
 * name. Its lobbies join it once the league read is wired.
 */
export const organizationRailOf = (
  view: OrganizationPeopleView,
): TimelineRail => ({
  title: view.name,
  subtitle: null,
  heading: null,
  items: [],
  footHeading: null,
  foot: [],
});
