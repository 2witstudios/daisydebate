import type { TournamentLobbyView } from '@daisy/protocol/lobby/lobby-read';
import { linkTo, unavailableAction, type TabAction } from './action';

/**
 * Where a stop stands. The first five ask something of the host, in that
 * order of urgency; `note` is a count, a start time or a word that asks
 * nothing.
 */
export type RailStanding =
  | { readonly kind: 'needs_you'; readonly count: number }
  | { readonly kind: 'live' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'unfinished'; readonly count: number }
  // A stop that is over, in its own word when it has one (`certified`).
  | { readonly kind: 'done'; readonly as?: string }
  | { readonly kind: 'note'; readonly text: string };

/** One stop on the timeline rail: a setup page, a time slot or the results. */
export type RailItem = {
  readonly id: string;
  readonly label: string;
  /** A time slot's start, shown before its name when events share slots. */
  readonly time: string | null;
  readonly standing: RailStanding | null;
  /** Null for a stop that cannot be opened yet. */
  readonly action: TabAction | null;
};

/** The host area's navigation: one tournament or league, in order. */
export type TimelineRail = {
  readonly title: string;
  readonly subtitle: string | null;
  /** A label over the stops, where they are not one tournament's timeline. */
  readonly heading: string | null;
  readonly items: readonly RailItem[];
  readonly footHeading: string | null;
  readonly foot: readonly RailItem[];
};

/** A tournament in a list: a league's tournaments. */
type TournamentRow = {
  readonly name: string;
  readonly detail: string;
  readonly action: TabAction;
};

export type TournamentGroup = {
  readonly heading: string;
  readonly rows: readonly TournamentRow[];
  /** The rest of the group, behind one link. */
  readonly more: TabAction | null;
};

/**
 * A page a projection may link to. Reads carry ids and handles, never
 * addresses: the delivery answers where each place lives, or null where it
 * has no page yet (the control then has no operation behind it).
 */
export type TabPlace =
  | { readonly kind: 'tournament'; readonly handle: string }
  | {
      readonly kind: 'round';
      readonly handle: string;
      readonly eventId: string;
      readonly number: number;
    }
  | { readonly kind: 'standings'; readonly handle: string }
  | { readonly kind: 'bracket'; readonly handle: string }
  | { readonly kind: 'entries'; readonly handle: string }
  | { readonly kind: 'room'; readonly roomId: string }
  | { readonly kind: 'live_room'; readonly roomId: string }
  | { readonly kind: 'ballot'; readonly roomId: string }
  | {
      readonly kind: 'host';
      readonly handle: string;
      readonly page:
        'setup' | 'events' | 'entries' | 'people' | 'standings' | 'results';
    }
  | {
      readonly kind: 'host_round';
      readonly handle: string;
      readonly eventId: string;
      readonly number: number;
    }
  | {
      readonly kind: 'host_slot';
      readonly handle: string;
      readonly timeSlotId: string;
    }
  | { readonly kind: 'past_tournaments' };
export type AddressOf = (place: TabPlace) => string | null;

/** A control to a place: a link where it has a page, else a sample action. */
const actionTo = (
  label: string,
  href: string | null,
  primary = false,
): TabAction =>
  href === null
    ? unavailableAction(label, primary)
    : linkTo(label, href, primary);
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

const pad = (n: number) => String(n).padStart(2, '0');
const clockOf = (at: string): string => {
  const date = new Date(at);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};
/** `14 Nov`. */
const dayMonthOf = (at: string): string => {
  const date = new Date(at);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()] ?? ''}`;
};

/** Whether the tournament's events share time slots. */
const isShared = (lobby: TournamentLobbyView): boolean =>
  lobby.timeSlots.some(
    (slot) => new Set(slot.tabRounds.map((round) => round.eventId)).size > 1,
  );

// The timeline rail.

const railStop = (
  id: string,
  label: string,
  standing: RailStanding | null,
  action: TabAction | null,
  time: string | null = null,
): RailItem => ({ id, label, time, standing, action });
const said = (text: string): RailStanding => ({ kind: 'note', text });
const done: RailStanding = { kind: 'done' };

const slotStanding = (
  state: NonNullable<TournamentLobbyView['host']>['slots'][number]['state'],
): RailStanding | null => {
  switch (state.kind) {
    case 'scheduled':
      return null;
    case 'drafting':
      return { kind: 'draft' };
    case 'drawn':
      return said('drawn');
    case 'needs_host':
      return { kind: 'needs_you', count: state.count };
    case 'live':
      return { kind: 'live' };
    case 'done':
      return done;
  }
};

const breakStanding = (
  state: NonNullable<TournamentLobbyView['host']>['breakState'],
): RailStanding | null => {
  switch (state) {
    case 'scheduled':
    case 'pending':
      return null;
    case 'ready':
      return { kind: 'ready' };
    case 'announced':
      return { kind: 'done', as: 'announced' };
  }
};

/**
 * The host's timeline: setup, the time slots in order and the results. Where
 * events share slots each slot is a stop with its start; with one event the
 * slots are its rounds, the break stands between the stages, and the
 * elimination rounds appear once the break is announced.
 */
export function timelineRailOf(
  lobby: TournamentLobbyView,
  addressOf: AddressOf,
): TimelineRail | null {
  const host = lobby.host;
  if (host === null) return null;
  const { handle } = lobby;
  const running = lobby.status === 'running' || lobby.status === 'completed';
  const to = (label: string, place: TabPlace) =>
    actionTo(label, addressOf(place));
  const hostPage = (
    label: string,
    page: Extract<TabPlace, { kind: 'host' }>['page'],
  ) => to(label, { kind: 'host', handle, page });
  const stateOf = (timeSlotId: string) =>
    host.slots.find((slot) => slot.timeSlotId === timeSlotId)?.state ?? {
      kind: 'scheduled' as const,
    };
  const people = railStop(
    'people',
    'People',
    null,
    hostPage('People', 'people'),
  );
  const head = [
    railStop(
      'setup',
      'Setup',
      host.setupUnfinished > 0
        ? { kind: 'unfinished', count: host.setupUnfinished }
        : done,
      hostPage('Setup', 'setup'),
    ),
    railStop(
      'events',
      'Events and schedule',
      said(String(lobby.events.length)),
      hostPage('Events and schedule', 'events'),
    ),
    railStop(
      'entries',
      'Entries',
      said(
        lobby.entry.opensAt === null
          ? String(host.entryCount)
          : `opens ${dayMonthOf(lobby.entry.opensAt)}`,
      ),
      hostPage('Entries', 'entries'),
    ),
  ];
  const results = railStop(
    'results',
    'Results',
    host.certified ? { kind: 'done', as: 'certified' } : null,
    running &&
      (isShared(lobby) || lobby.break === null || lobby.break.announced)
      ? hostPage('Results', 'results')
      : null,
  );
  const foot = [
    ...(host.setupUnfinished > 0
      ? []
      : [
          railStop(
            'standings',
            'Standings',
            null,
            hostPage('Standings', 'standings'),
          ),
        ]),
    people,
  ];
  const title = {
    title: lobby.name,
    subtitle: `${lobby.owner.kind === 'organization' ? lobby.owner.name : lobby.owner.username} · ${dayMonthOf(lobby.startsAt)}`,
    heading: null,
    footHeading: null,
  };
  if (isShared(lobby))
    return {
      ...title,
      items: [
        ...head,
        ...lobby.timeSlots.map((slot) => {
          const time = clockOf(slot.startsAt);
          return railStop(
            `slot-${time.replace(':', '')}`,
            slot.name,
            running ? slotStanding(stateOf(slot.timeSlotId)) : null,
            running
              ? to(slot.name, {
                  kind: 'host_slot',
                  handle,
                  timeSlotId: slot.timeSlotId,
                })
              : null,
            time,
          );
        }),
        results,
      ],
      foot,
    };
  const stageOf = (slot: TournamentLobbyView['timeSlots'][number]) =>
    slot.tabRounds[0]?.stage ?? 'preliminary';
  const prelims = lobby.timeSlots.filter(
    (slot) => stageOf(slot) === 'preliminary',
  );
  const roundStop = (slot: TournamentLobbyView['timeSlots'][number]) => {
    const round = slot.tabRounds[0];
    const id = `round-${round?.number ?? 0}`;
    if (!running || round === undefined)
      return railStop(id, slot.name, said(clockOf(slot.startsAt)), null);
    return railStop(
      id,
      slot.name,
      slotStanding(stateOf(slot.timeSlotId)),
      to(slot.name, {
        kind: 'host_round',
        handle,
        eventId: round.eventId,
        number: round.number,
      }),
    );
  };
  const last = prelims.at(-1)?.tabRounds[0];
  const prelimsDone =
    running &&
    prelims.every((slot) => stateOf(slot.timeSlotId).kind === 'done');
  const breakStop =
    lobby.break === null
      ? []
      : [
          railStop(
            'break',
            'Break',
            running
              ? breakStanding(host.breakState)
              : said(clockOf(lobby.break.at)),
            running ? hostPage('Break', 'standings') : null,
          ),
        ];
  const elims =
    lobby.break?.announced === true
      ? lobby.timeSlots
          .filter((slot) => stageOf(slot) === 'elimination')
          .map((slot) =>
            railStop(
              slot.name.toLowerCase().replaceAll(' ', '-'),
              slot.name,
              slotStanding(stateOf(slot.timeSlotId)),
              hostPage('Results', 'results'),
            ),
          )
      : [];
  return {
    ...title,
    items: [
      ...head,
      ...(prelimsDone && last !== undefined
        ? [
            railStop(
              `round-${last.number}`,
              `Rounds 1 to ${last.number}`,
              done,
              to(`Round ${last.number}`, {
                kind: 'host_round',
                handle,
                eventId: last.eventId,
                number: last.number,
              }),
            ),
          ]
        : prelims.map(roundStop)),
      ...breakStop,
      ...elims,
      results,
    ],
    foot,
  };
}

/** A stop's standing in the words the rail shows. */
export const standingLabel = (standing: RailStanding): string => {
  switch (standing.kind) {
    case 'needs_you':
      return standing.count === 1
        ? '1 needs you'
        : `${standing.count} need you`;
    case 'unfinished':
      return `${standing.count} to finish`;
    case 'note':
      return standing.text;
    case 'done':
      return standing.as ?? standing.kind;
    case 'live':
    case 'draft':
    case 'ready':
      return standing.kind;
  }
};

const urgency: readonly RailStanding['kind'][] = [
  'needs_you',
  'live',
  'draft',
  'ready',
  'unfinished',
];

/**
 * Where a host lands on opening a tournament: the stop that most wants them.
 * With nothing wanting them they land on the last stop when that one is over
 * (a finished tournament opens on its results), and on the first otherwise.
 */
export function landingStop(rail: TimelineRail): string | null {
  const open = rail.items.filter((item) => item.action?.kind === 'link');
  const wanted = urgency
    .map((kind) => open.find((item) => item.standing?.kind === kind))
    .find((item) => item !== undefined);
  const last = open.at(-1);
  const rest = last?.standing?.kind === 'done' ? last : open[0];
  const action = (wanted ?? rest)?.action;
  return action?.kind === 'link' ? action.href : null;
}
