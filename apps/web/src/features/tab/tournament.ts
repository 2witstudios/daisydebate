import type {
  DayRow as DayRead,
  DayView,
} from '@daisy/protocol/lobby/day-read';
import type {
  ListedLobby,
  LobbyListPage,
  TabRoundRef,
  TournamentLobbyView,
} from '@daisy/protocol/lobby/lobby-read';
import type {
  PostedJudge,
  PostingView,
  ShownEntrant,
} from '@daisy/protocol/lobby/posting-read';
import { linkTo, sampleAction, type TabAction } from './action';
import type { Bracket } from './results';
import { hostRoutes, tabRoutes } from './routes';
import { sampleTimelineRead } from './sample/rail';
import {
  sampleAddressOf,
  sampleTournamentListRead,
  sampleTournamentReads,
} from './sample/tournament';
import type { SampleScene } from './sample/scene';
import type { StandingsTable } from './standings';

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

export type PinnedRoom = {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction;
};

export type PostingRow = {
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction | null;
};

export type DayRow = {
  readonly time: string;
  readonly title: string;
  readonly detail: string;
  readonly href: string | null;
};

export type TournamentPanel =
  | {
      readonly kind: 'posting';
      readonly heading: string;
      readonly rows: readonly PostingRow[];
      readonly more: number;
    }
  | {
      readonly kind: 'day';
      readonly groups: readonly {
        readonly heading: string;
        readonly rows: readonly DayRow[];
      }[];
    }
  /** Not open to this viewer yet. */
  | { readonly kind: 'closed'; readonly title: string }
  | { readonly kind: 'standings'; readonly table: StandingsTable }
  | { readonly kind: 'bracket'; readonly bracket: Bracket };

export type TournamentTab = {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly selected: boolean;
};

/** A responsible adult's entry at a tournament, as it stands right now. */
export type AdultEntry = {
  readonly name: string;
  readonly facts: string;
  readonly detail: string;
  readonly action: TabAction;
};

/** Something of a round this viewer may open: a ballot, a recording. */
export type ReadableBallot = {
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction;
};

/** What a finished tournament keeps for someone who took part. */
export type Keepsakes = {
  readonly rows: readonly ReadableBallot[];
  /** The earlier rounds, behind one link. */
  readonly more: TabAction;
};

/** The participant side's tournament page, by who is looking and when. */
export type TournamentPage =
  | {
      readonly kind: 'before';
      readonly name: string;
      readonly lede: string;
      readonly places: string;
      readonly closes: string;
      readonly enter: TabAction;
      readonly terms: readonly {
        readonly title: string;
        readonly detail: string;
      }[];
      readonly entered: string | null;
    }
  | {
      readonly kind: 'rounds';
      readonly name: string;
      readonly lede: string;
      readonly headerAction: TabAction | null;
      readonly yourRoom: PinnedRoom | null;
      readonly tabs: readonly TournamentTab[];
      readonly panel: TournamentPanel;
      readonly note: string | null;
      readonly noteAction: TabAction | null;
      /** A signed-out reader's way in. */
      readonly signIn: TabAction | null;
    }
  | {
      readonly kind: 'adult';
      readonly name: string;
      readonly lede: string;
      readonly now: readonly AdultEntry[];
      readonly ballots: readonly ReadableBallot[];
      readonly ballotsNote: string;
      readonly judging: PinnedRoom | null;
      readonly manage: TabAction;
    }
  | {
      /** A finished tournament, for someone who took part in it. */
      readonly kind: 'after';
      readonly name: string;
      readonly lede: string;
      readonly result: PinnedRoom;
      readonly ballots: Keepsakes;
      readonly recordings: Keepsakes;
      readonly recordingsNote: string;
    };

export type TournamentView =
  | { readonly kind: 'home' }
  | { readonly kind: 'round'; readonly event: string; readonly round: string }
  | { readonly kind: 'standings'; readonly event: string | null }
  | { readonly kind: 'bracket'; readonly event: string | null };

/** A tournament in a list: the index, a league's tournaments. */
export type TournamentRow = {
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

/** The tournaments index: this viewer's own first, then what is open. */
export type TournamentsIndex = {
  readonly groups: readonly TournamentGroup[];
  /** Null for a signed-out reader. */
  readonly host: TabAction | null;
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
export const actionTo = (
  label: string,
  href: string | null,
  primary = false,
): TabAction =>
  href === null ? sampleAction(label, primary) : linkTo(label, href, primary);

// Wall-clock words. Instants are UTC and a tournament's day is read in UTC.
const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
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
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const minuteMs = 60_000;
const dayMs = 24 * 60 * minuteMs;

const pad = (n: number) => String(n).padStart(2, '0');
export const clockOf = (at: string): string => {
  const date = new Date(at);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};
export const weekdayOf = (at: string): string =>
  weekdays[new Date(at).getUTCDay()] ?? '';
export const shortWeekdayOf = (at: string): string => weekdayOf(at).slice(0, 3);
/** `14 Nov`. */
export const dayMonthOf = (at: string): string => {
  const date = new Date(at);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()] ?? ''}`;
};
export const monthOf = (at: string): string =>
  monthNames[new Date(at).getUTCMonth()] ?? '';
/** `Saturday 14 Nov`. */
export const longDateOf = (at: string): string =>
  `${weekdayOf(at)} ${dayMonthOf(at)}`;
/** `Sat 14 Nov`. */
export const shortDateOf = (at: string): string =>
  `${shortWeekdayOf(at)} ${dayMonthOf(at)}`;
/** `opens in 6 minutes` within the hour, else `opens 15:20`. */
export const opensPhrase = (at: string, asOf: string): string => {
  const minutes = Math.round((Date.parse(at) - Date.parse(asOf)) / minuteMs);
  return minutes > 0 && minutes < 60
    ? `opens in ${minutes} minute${minutes === 1 ? '' : 's'}`
    : `opens ${clockOf(at)}`;
};
const withinWeek = (at: string, asOf: string) =>
  Math.abs(Date.parse(at) - Date.parse(asOf)) < 7 * dayMs;

const numberWords = [
  'none',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;
export const numberWord = (n: number): string => numberWords[n] ?? String(n);
export const capitalized = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);
export const ordinalOf = (n: number): string => {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
};
/** `A and B`, `A, B and C`. */
export const listed = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
export const shownName = (shown: ShownEntrant): string =>
  shown.kind === 'name' ? shown.name : shown.initials;

/** Whether the tournament's events share time slots. */
const isShared = (lobby: TournamentLobbyView): boolean =>
  lobby.timeSlots.some(
    (slot) => new Set(slot.tabRounds.map((round) => round.eventId)).size > 1,
  );

const eventName = (lobby: TournamentLobbyView, eventId: string): string =>
  lobby.events.find((event) => event.eventId === eventId)?.name ?? '';

/**
 * A tab round as a page names it: the host's name, else its number, with
 * the event first where events share the schedule.
 */
export const tabRoundLabel = (
  round: TabRoundRef,
  event: string,
  shared: boolean,
): string =>
  round.name ??
  (shared ? `${event} round ${round.number}` : `Round ${round.number}`);

/** `Judge L. Malik`, or `three judges`. */
const judgesPhrase = (judges: readonly PostedJudge[]): string =>
  judges.length === 1
    ? `Judge ${judges[0]?.name ?? ''}`
    : `${numberWord(judges.length)} judges`;

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

// The participant tournament page.

/** What one tournament page is projected from. */
export type TournamentReads = {
  readonly lobby: TournamentLobbyView;
  /** The posting the page's round view shows; null where none is open. */
  readonly posting: PostingView | null;
  /** The viewer's day; null for someone with no part in it. */
  readonly day: DayView | null;
  readonly standings: StandingsTable | null;
  readonly bracket: Bracket | null;
};

type DayLine = DayRead & {
  readonly slot: { readonly name: string; readonly startsAt: string };
};
const dayLines = (day: DayView | null): readonly DayLine[] =>
  (day?.slots ?? []).flatMap((slot) =>
    slot.rows.map((row) => ({ ...row, slot })),
  );
const isOver = (row: DayRead) => row.state.kind === 'over';
const opponentsOf = (row: DayRead): readonly string[] =>
  (row.fixture?.entries ?? [])
    .filter((entry) => !entry.own)
    .map((entry) => shownName(entry.shown));
const ownSide = (row: DayRead): string =>
  row.fixture?.entries.find((entry) => entry.own)?.side ?? '';

function beforePage(
  lobby: TournamentLobbyView,
  addressOf: AddressOf,
): TournamentPage {
  const { entry, owner } = lobby;
  const ownerName =
    owner.kind === 'organization' ? owner.name : `hosted by ${owner.username}`;
  const who =
    entry.limit ??
    (entry.eligibility === 'anyone'
      ? 'open to anyone'
      : entry.eligibility === 'organization_added'
        ? 'schools and families the league has added'
        : `${owner.kind === 'organization' ? owner.name : owner.username} members`);
  const entered = lobby.entered;
  return {
    kind: 'before',
    name: lobby.name,
    lede: `${longDateOf(lobby.startsAt)}, ${clockOf(lobby.startsAt)} · ${lobby.place === 'online' ? 'online' : 'in person'} · ${ownerName}`,
    places:
      entry.opensAt !== null
        ? `Entries open ${dayMonthOf(entry.opensAt)}`
        : entry.capacity === null
          ? `${entry.taken} entered`
          : `${entry.taken} of ${entry.capacity} places taken`,
    closes: `${
      entry.opensAt !== null
        ? `Entries close ${shortDateOf(entry.closesAt)}`
        : `Entry closes ${weekdayOf(entry.closesAt)} ${clockOf(entry.closesAt)}`
    } · ${who}`,
    enter: lobby.capabilities.manageEntries
      ? linkTo(
          'Manage entries',
          addressOf({ kind: 'entries', handle: lobby.handle }) ??
            tabRoutes.entries(lobby.handle),
          true,
        )
      : sampleAction('Enter', true),
    terms: lobby.terms,
    entered:
      entered === null
        ? null
        : entered.kind === 'schools'
          ? `${entered.schools.map((school) => `${school.name} · ${school.entries}`).join(', ')}${entered.more > 0 ? ` and ${entered.more} more schools` : ''}`
          : `${entered.people.map((person) => `${person.username} · ${person.rating}`).join(', ')}${entered.more > 0 ? ` and ${entered.more} more` : ''}`,
  };
}

const outcomeOf = (row: DayRead): string | null => {
  const result = row.result;
  if (result?.kind !== 'released') return null;
  const decision = result.decision;
  return decision.kind === 'debate'
    ? decision.won
      ? 'won'
      : 'lost'
    : `ranked ${ordinalOf(decision.rank)} of ${decision.of}`;
};

/** A finished tournament, for someone who took part in it. */
function afterPage(
  { lobby, day }: TournamentReads,
  addressOf: AddressOf,
): TournamentPage | null {
  const entry = lobby.viewerEntries[0];
  const finish = entry?.finish ?? null;
  if (entry === undefined || finish === null || lobby.certifiedAt === null)
    return null;
  const shared = isShared(lobby);
  const own = dayLines(day).filter(
    (row) => row.person.kind === 'self' && row.role === 'competitor',
  );
  const elims = own
    .filter((row) => row.tabRound.stage === 'elimination')
    .reverse();
  const prelims = own.filter((row) => row.tabRound.stage === 'preliminary');
  const label = (row: DayRead) =>
    tabRoundLabel(row.tabRound, row.event.name, shared);
  const more = sampleAction(
    `Rounds 1 to ${Math.max(0, ...prelims.map((row) => row.tabRound.number))}`,
  );
  const out = finish.out;
  const owner =
    lobby.owner.kind === 'organization'
      ? lobby.owner.name
      : lobby.owner.username;
  return {
    kind: 'after',
    name: lobby.name,
    lede: `Finished ${dayMonthOf(lobby.certifiedAt)} · results certified`,
    result: {
      eyebrow: `Your result · ${eventName(lobby, entry.eventId)}`,
      title: `${out === null ? 'Champion' : `${out.tabRoundName}ist`} · ${ordinalOf(finish.place)} of ${finish.of}`,
      detail: [
        entry.record === null
          ? null
          : `${entry.record.wins}-${entry.record.losses} in prelims`,
        out === null
          ? null
          : `lost the ${out.tabRoundName.toLowerCase()} to ${out.to}, ${out.judgesAgainst} judges to ${out.judgesFor}`,
        finish.seasonPoints === null
          ? null
          : `${finish.seasonPoints} points toward the ${owner} season`,
      ]
        .filter((part) => part !== null)
        .join(' · '),
      action: linkTo(
        'Bracket and final standings',
        addressOf({ kind: 'bracket', handle: lobby.handle }) ??
          tabRoutes.bracket(lobby.handle),
        true,
      ),
    },
    ballots: {
      rows: elims.flatMap((row) => {
        const result = row.result;
        if (result?.kind !== 'released' || result.decision.kind !== 'debate')
          return [];
        const { judgesFor, judgesAgainst } = result.decision;
        return [
          {
            title: `${label(row)} · ${outcomeOf(row) ?? ''} ${judgesFor}-${judgesAgainst}`,
            detail: `v ${listed(opponentsOf(row))} · ${judgesPhrase(row.fixture?.judges ?? [])}`,
            action: sampleAction('Read'),
          },
        ];
      }),
      more,
    },
    recordings: {
      rows: elims.flatMap((row) =>
        row.recording === null
          ? []
          : [
              {
                title: `${label(row)} v ${listed(opponentsOf(row))}`,
                detail: `${Math.round(row.recording.durationMs / minuteMs)} minutes`,
                action: sampleAction('Watch'),
              },
            ],
      ),
      more,
    },
    recordingsNote:
      'Only the people in a round, and their parents or coaches, can watch its recording.',
  };
}

/** A responsible adult's view: their entries now, what they may read. */
function adultPage(
  { lobby, day }: TournamentReads,
  addressOf: AddressOf,
): TournamentPage {
  const shared = isShared(lobby);
  const lines = dayLines(day);
  const wards = lobby.wards.map((ward) => ward.name);
  const school = lobby.school?.name ?? '';
  const personOf = (row: DayRead) =>
    row.person.kind === 'ward' ? row.person.name : (row.entry?.name ?? '');
  const theirs = lines.filter(
    (row) => row.role === 'competitor' && row.person.kind !== 'self',
  );
  const people = wards.length > 0 ? wards : [...new Set(theirs.map(personOf))];
  const label = (row: DayRead) =>
    tabRoundLabel(row.tabRound, row.event.name, shared);
  const now = people.flatMap((person) => {
    const row = theirs.find(
      (line) =>
        personOf(line) === person && !isOver(line) && line.fixture !== null,
    );
    return row === undefined ? [] : [row];
  });
  const stateWords = (row: DayRead) =>
    row.state.kind === 'live'
      ? 'speaking now'
      : row.state.kind === 'posted'
        ? `opens ${clockOf(row.state.opensAt)}`
        : '';
  const judging = lines.find(
    (row) => row.person.kind === 'self' && row.role === 'judge' && !isOver(row),
  );
  return {
    kind: 'adult',
    name: lobby.name,
    lede: wards.length > 0 ? "Your children's entries" : `${school}'s entries`,
    now: now.map((row, index) => ({
      name: personOf(row),
      facts: [
        row.event.name,
        row.entry?.record === null || row.entry === null
          ? null
          : `${row.entry.record.wins}-${row.entry.record.losses}`,
      ]
        .filter((part) => part !== null)
        .join(' · '),
      detail: [
        row.fixture?.kind === 'section'
          ? label(row)
          : `${label(row)} v ${listed(opponentsOf(row))}`,
        row.fixture?.room?.name ?? null,
        stateWords(row),
      ]
        .filter((part) => part !== null && part !== '')
        .join(' · '),
      action:
        row.state.kind === 'live'
          ? sampleAction('Watch', index === 0)
          : sampleAction('Details'),
    })),
    ballots: people.flatMap((person) =>
      theirs
        .filter((row) => personOf(row) === person && outcomeOf(row) !== null)
        .reverse()
        .map((row) => {
          const result = row.result;
          const judges = row.fixture?.judges ?? [];
          return {
            title: `${person} · ${label(row)} · ${outcomeOf(row) ?? ''}`,
            detail: [
              result?.kind === 'released' && result.scores !== null
                ? `${result.scores.points} points`
                : null,
              capitalized(judgesPhrase(judges)),
            ]
              .filter((part) => part !== null)
              .join(' · '),
            action: sampleAction('Read'),
          };
        }),
    ),
    ballotsNote: `${wards.length > 0 ? listed(wards) : 'Your debaters'} see their results now, and scores and feedback after prelims are certified.`,
    judging:
      judging === undefined || judging.fixture === null
        ? null
        : {
            eyebrow: `You're judging at ${clockOf(judging.state.kind === 'posted' ? judging.state.opensAt : judging.slot.startsAt)}`,
            title: `${judging.event.name} · ${judging.fixture.room?.name ?? ''}`,
            detail: `Never a room with ${wards.join(', ')} or their club.`,
            action: sampleAction('Open'),
          },
    manage:
      wards.length > 0
        ? linkTo(
            `Manage ${listed(wards.map((ward) => `${ward}'s`))} accounts`,
            tabRoutes.family,
          )
        : linkTo(
            `Manage ${school}'s entries`,
            addressOf({ kind: 'entries', handle: lobby.handle }) ??
              tabRoutes.entries(lobby.handle),
          ),
  };
}

/** The viewer's own Room now: the first published fixture not yet over. */
function pinnedRoom(
  lobby: TournamentLobbyView,
  lines: readonly DayLine[],
  addressOf: AddressOf,
): PinnedRoom | null {
  const row = lines.find(
    (line) =>
      line.person.kind === 'self' && line.fixture !== null && !isOver(line),
  );
  const fixture = row?.fixture ?? null;
  if (row === undefined || fixture === null) return null;
  const shared = isShared(lobby);
  const label = tabRoundLabel(row.tabRound, row.event.name, shared);
  const room = fixture.room;
  const roomName = room?.name ?? '';
  const roomHref =
    room === null ? null : addressOf({ kind: 'room', roomId: room.roomId });
  const names = fixture.entries.map((entry) => shownName(entry.shown));
  const opens =
    row.state.kind === 'posted'
      ? opensPhrase(row.state.opensAt, lobby.asOf)
      : null;
  if (row.role === 'judge') {
    const due = row.state.kind === 'ballots_due';
    const count = fixture.judges.length;
    return {
      eyebrow: `You are judging · ${label} · ${due ? roomName : (opens ?? roomName)}`,
      title: names.join(' v '),
      detail: due
        ? `1 of ${count} judges · the speeches have ended`
        : `${roomName} · ${count === 1 ? 'you are the only judge' : `you are 1 of ${count} judges`}`,
      action: due
        ? actionTo(
            'Open your ballot',
            room === null
              ? null
              : addressOf({ kind: 'ballot', roomId: room.roomId }),
            true,
          )
        : actionTo('Go to room', roomHref, true),
    };
  }
  const entry = lobby.viewerEntries.find(
    (own) => own.entryId === row.entry?.entryId,
  );
  const partners = entry?.partners ?? [];
  const chair = fixture.judges.find((judge) => judge.chair);
  const judges = `${judgesPhrase(fixture.judges)}${chair === undefined ? '' : ` · ${chair.name} chairs`}`;
  const live =
    row.state.kind === 'live'
      ? row.state.phase === 'preparing' && row.state.speechesBeginAt !== null
        ? `preparing, speeches begin ${clockOf(row.state.speechesBeginAt)}`
        : 'speaking now'
      : null;
  const [title, detail] =
    fixture.entries.length > 2
      ? [`${ownSide(row)} with ${listed(partners)}`, `${roomName} · ${judges}`]
      : partners.length > 0
        ? [
            `${ownSide(row)} v ${listed(opponentsOf(row))}`,
            [roomName, judges, live]
              .filter((part) => part !== null)
              .join(' · '),
          ]
        : [
            fixture.entries
              .map((one) => (one.own ? 'You' : shownName(one.shown)))
              .join(' v '),
            `${roomName} · you are ${ownSide(row)} · ${judges}`,
          ];
  return {
    eyebrow: ['Your room', label, opens]
      .filter((part) => part !== null)
      .join(' · '),
    title,
    detail,
    action:
      row.state.kind === 'live'
        ? actionTo('Join', roomHref, true)
        : actionTo('Go to room', roomHref, true),
  };
}

/** The viewer's day, after their own Room: what is still to come, then what is done. */
function dayPanel(
  lobby: TournamentLobbyView,
  day: DayView | null,
  pinned: DayRead | null,
  addressOf: AddressOf,
): TournamentPanel {
  const shared = isShared(lobby);
  const slotRows = (day?.slots ?? []).map((slot) => ({
    slot,
    rows: slot.rows.filter(
      (row) =>
        row.person.kind === 'self' &&
        row.tabRound.tabRoundId !== pinned?.tabRound.tabRoundId,
    ),
  }));
  const rowOf = (
    slot: DayView['slots'][number],
    rows: readonly DayRead[],
  ): DayRow | null => {
    const row = rows[0];
    if (row === undefined) return null;
    const label = tabRoundLabel(row.tabRound, row.event.name, shared);
    const fixture = row.fixture;
    const breaking = row.breaking;
    const title =
      rows.length > 1
        ? slot.name
        : breaking !== null && breaking.divisions.length > 0
          ? `${row.event.name} breaks`
          : outcomeOf(row) !== null && fixture?.kind !== 'section'
            ? `${label} · ${outcomeOf(row) ?? ''}`
            : label;
    const detail =
      breaking !== null
        ? breaking.divisions.length > 0
          ? `Eligible for ${listed(breaking.divisions)} breaks`
          : `Top ${numberWord(breaking.size ?? 0)} in ${rows.map((one) => one.event.name).join(' or ')}`
        : fixture === null
          ? `Posted when round ${row.tabRound.number - 1} finishes`
          : fixture.kind === 'section'
            ? [
                fixture.room?.name ?? null,
                fixture.speaks === null
                  ? null
                  : `${ordinalOf(fixture.speaks.position)} of ${numberWord(fixture.speaks.of)}`,
                fixture.topicAt === null || isOver(row)
                  ? null
                  : `topic at ${clockOf(fixture.topicAt)}`,
                row.result?.kind === 'withheld'
                  ? 'ranks come after prelims'
                  : null,
              ]
                .filter((part) => part !== null)
                .join(' · ')
            : `${ownSide(row)} v ${listed(opponentsOf(row))}`;
    const room = fixture?.room ?? null;
    return {
      time: clockOf(slot.startsAt),
      title,
      detail,
      href:
        room === null
          ? null
          : addressOf({ kind: 'live_room', roomId: room.roomId }),
    };
  };
  const later = slotRows
    .filter(({ rows }) => rows.length > 0 && !rows.every(isOver))
    .map(({ slot, rows }) => rowOf(slot, rows));
  const over = slotRows
    .filter(({ rows }) => rows.length > 0 && rows.every(isOver))
    .reverse()
    .map(({ slot, rows }) => rowOf(slot, rows));
  const group = (heading: string, rows: readonly (DayRow | null)[]) => {
    const kept = rows.filter((row) => row !== null);
    return kept.length === 0 ? [] : [{ heading, rows: kept }];
  };
  return {
    kind: 'day',
    groups: [...group('Later today', later), ...group('Done', over)],
  };
}

function postingPanel(
  lobby: TournamentLobbyView,
  posting: PostingView,
  addressOf: AddressOf,
): TournamentPanel {
  const shared = isShared(lobby);
  const rooms = `${posting.roomCount} rooms`;
  const heading =
    posting.startedAt === null
      ? capitalized(
          [posting.tabRound.name, `opens ${clockOf(posting.opensAt)}`, rooms]
            .filter((part) => part !== null)
            .join(' · '),
        )
      : [
          tabRoundLabel(posting.tabRound, posting.event.name, shared),
          `started ${clockOf(posting.startedAt)}`,
          shared ? rooms : null,
        ]
          .filter((part) => part !== null)
          .join(' · ');
  return {
    kind: 'posting',
    heading,
    rows: posting.fixtures.map((fixture) => {
      const names = fixture.entries.map((entry) => shownName(entry.shown));
      const chair = fixture.judges.find((judge) => judge.chair);
      const others = fixture.judges.filter((judge) => !judge.chair);
      const judges =
        chair === undefined
          ? `Judge ${fixture.judges.map((judge) => judge.name).join(', ')}`
          : `${chair.name} chairs · ${others.map((judge) => judge.name).join(', ')}`;
      const room = fixture.room;
      const roomHref =
        room === null ? null : addressOf({ kind: 'room', roomId: room.roomId });
      return {
        title: names.join(names.length === 2 ? ' v ' : ', '),
        detail: [room?.name ?? null, judges]
          .filter((part) => part !== null)
          .join(' · '),
        action: !fixture.video
          ? null
          : roomHref === null
            ? sampleAction('Watch')
            : linkTo('Room', roomHref),
      };
    }),
    more: posting.more,
  };
}

const resultsClosed = (title: string): TournamentPanel => ({
  kind: 'closed',
  title,
});

/** The posted rounds a page shows tabs for, in schedule order. */
const postedRounds = (lobby: TournamentLobbyView) =>
  lobby.timeSlots.flatMap((slot) =>
    slot.tabRounds.filter((round) => round.posting),
  );

function roundsPage(
  reads: TournamentReads,
  view: TournamentView,
  addressOf: AddressOf,
): TournamentPage {
  const { lobby, posting, day } = reads;
  const { handle } = lobby;
  const shared = isShared(lobby);
  const owner =
    lobby.owner.kind === 'organization'
      ? lobby.owner.name
      : lobby.owner.username;
  const participant = lobby.viewerRoles.length > 0;
  const announced = lobby.break?.announced ?? false;
  const entries = lobby.viewerEntries;
  const severalEvents = new Set(entries.map((entry) => entry.eventId)).size > 1;
  const lines = dayLines(day);
  const pinnedLine =
    lines.find(
      (line) =>
        line.person.kind === 'self' && line.fixture !== null && !isOver(line),
    ) ?? null;
  const showDay = severalEvents && view.kind === 'home';
  const single = entries.length === 1 ? entries[0] : undefined;
  const lede =
    single !== undefined
      ? `${eventName(lobby, single.eventId)}${single.record === null ? '' : ` · you are ${single.record.wins}-${single.record.losses}`}`
      : entries.length > 1
        ? entries
            .map(
              (entry) =>
                `${eventName(lobby, entry.eventId)}${entry.partners.length > 0 ? ` with ${listed(entry.partners)}` : ''}`,
            )
            .join(' · ')
        : shared
          ? `${owner} · ${longDateOf(lobby.startsAt)}`
          : participant
            ? (lobby.events[0]?.name ?? '')
            : `${owner} · ${longDateOf(lobby.startsAt)} · ${lobby.events[0]?.name ?? ''}`;
  const rounds = postedRounds(lobby);
  const roundTab = (
    round: (typeof rounds)[number],
    id: string,
    label: string,
    selected: string,
  ) => ({
    id,
    label,
    href:
      addressOf({
        kind: 'round',
        handle,
        eventId: round.eventId,
        number: round.number,
      }) ?? tabRoutes.tournament(handle),
    selected: id === selected,
  });
  const standingsHref =
    addressOf({ kind: 'standings', handle }) ?? tabRoutes.standings(handle);
  const bracketHref =
    addressOf({ kind: 'bracket', handle }) ?? tabRoutes.bracket(handle);
  const first = rounds[0];
  const latest = rounds.at(-1);
  const tabs: TournamentTab[] = shared
    ? (() => {
        const selected = showDay
          ? 'day'
          : view.kind === 'home'
            ? 'round'
            : view.kind;
        return [
          ...(severalEvents
            ? [
                {
                  id: 'day',
                  label: 'Your day',
                  href:
                    addressOf({ kind: 'tournament', handle }) ??
                    tabRoutes.tournament(handle),
                  selected: selected === 'day',
                },
              ]
            : []),
          ...(first === undefined
            ? []
            : [roundTab(first, 'round', 'Rooms', selected)]),
          {
            id: 'standings',
            label: 'Standings',
            href: standingsHref,
            selected: selected === 'standings',
          },
          {
            id: 'bracket',
            label: 'Brackets',
            href: bracketHref,
            selected: selected === 'bracket',
          },
        ];
      })()
    : (() => {
        const several = rounds.length > 1;
        const selectedRound =
          view.kind === 'home'
            ? String(latest?.number ?? '')
            : view.kind === 'round'
              ? view.round
              : null;
        const selected = several
          ? (selectedRound ?? view.kind)
          : view.kind === 'standings'
            ? 'standings'
            : 'round';
        const breakLine = participant && !announced && lobby.results.standings;
        return [
          ...(several
            ? rounds.map((round) =>
                roundTab(
                  round,
                  String(round.number),
                  tabRoundLabel(round, eventName(lobby, round.eventId), false),
                  selected,
                ),
              )
            : first === undefined
              ? []
              : [
                  roundTab(
                    first,
                    'round',
                    tabRoundLabel(
                      first,
                      eventName(lobby, first.eventId),
                      false,
                    ),
                    selected,
                  ),
                ]),
          ...(lobby.results.bracket !== 'closed' && (!participant || announced)
            ? [
                {
                  id: 'bracket',
                  label: 'Bracket',
                  href: bracketHref,
                  selected: selected === 'bracket',
                },
              ]
            : []),
          {
            id: 'standings',
            label: breakLine ? 'Break' : 'Standings',
            href: standingsHref,
            selected: selected === 'standings',
          },
        ];
      })();
  const panel: TournamentPanel = showDay
    ? dayPanel(lobby, day, pinnedLine, addressOf)
    : view.kind === 'standings'
      ? lobby.results.standings && reads.standings !== null
        ? { kind: 'standings', table: reads.standings }
        : resultsClosed('Results appear here when the break is announced.')
      : view.kind === 'bracket'
        ? reads.bracket !== null
          ? { kind: 'bracket', bracket: reads.bracket }
          : resultsClosed(
              lobby.results.bracket === 'not_drawn'
                ? 'The bracket appears when the break is announced.'
                : 'Results appear here when the break is announced.',
            )
        : posting === null
          ? resultsClosed('The posting appears when the round is drawn.')
          : postingPanel(lobby, posting, addressOf);
  const watched = severalEvents
    ? undefined
    : lines
        .filter(
          (line) =>
            line.person.kind === 'self' &&
            line.recording !== null &&
            outcomeOf(line) !== null,
        )
        .at(-1);
  const completed = lobby.status === 'completed' && lobby.certifiedAt !== null;
  const note = !lobby.signedIn
    ? `${announced ? '' : 'Results appear here when the break is announced. '}Competitors under 16 are shown by initials. Video is for people taking part.`
    : completed && lobby.certifiedAt !== null
      ? `Certified at ${clockOf(lobby.certifiedAt)}. Scores and feedback are open to you.`
      : showDay
        ? 'If a round runs into your next one, stay where you are. Tab can see it and holds your next room.'
        : watched === undefined
          ? null
          : `${tabRoundLabel(watched.tabRound, watched.event.name, shared)}: you ${outcomeOf(watched) ?? ''}. Scores and feedback open after prelims.`;
  return {
    kind: 'rounds',
    name: lobby.name,
    lede,
    headerAction:
      participant && !shared && lobby.results.standings
        ? linkTo('Standings', standingsHref)
        : null,
    // A responsible adult's own judging is pinned on their entries page.
    yourRoom: lobby.viewerRoles.includes('responsible_adult')
      ? null
      : pinnedRoom(lobby, lines, addressOf),
    tabs,
    panel,
    note,
    noteAction:
      lobby.signedIn && !completed && !showDay && watched !== undefined
        ? sampleAction('Watch it back')
        : null,
    signIn: lobby.signedIn
      ? null
      : linkTo('Taking part? Sign in to see your room', '/sign-in', true),
  };
}

/**
 * The participant tournament page, by who is looking and when: the terms
 * before it runs, a responsible adult's entries, the rounds while it runs,
 * and what a finished tournament keeps for someone who took part.
 */
export function tournamentPageOf(
  reads: TournamentReads,
  view: TournamentView,
  addressOf: AddressOf,
): TournamentPage | null {
  const { lobby } = reads;
  if (
    view.kind === 'round' &&
    !postedRounds(lobby).some(
      (round) =>
        String(round.number) === view.round &&
        addressOf({
          kind: 'round',
          handle: lobby.handle,
          eventId: round.eventId,
          number: round.number,
        }) === tabRoutes.round(lobby.handle, view.event, view.round),
    )
  )
    return null;
  if (lobby.status === 'draft' || lobby.status === 'open')
    return beforePage(lobby, addressOf);
  const roles = lobby.viewerRoles;
  if (view.kind === 'home') {
    if (
      roles.includes('responsible_adult') &&
      !roles.includes('competitor') &&
      reads.day !== null
    )
      return adultPage(reads, addressOf);
    if (roles.includes('competitor') && lobby.status === 'completed')
      return afterPage(reads, addressOf);
  }
  return roundsPage(reads, view, addressOf);
}

// The tournaments index.

const ownerWords = (lobby: Extract<ListedLobby, { kind: 'tournament' }>) =>
  lobby.entry.eligibility === 'organization_members'
    ? `${lobby.owner.kind === 'organization' ? lobby.owner.name : lobby.owner.username} members`
    : lobby.owner.kind === 'organization'
      ? lobby.owner.name
      : `hosted by ${lobby.owner.username}`;

/** `entry closes Thursday 17:00` within the week, `entry closes 25 Nov` beyond. */
export const entryClosesPhrase = (closesAt: string, asOf: string): string =>
  `entry closes ${withinWeek(closesAt, asOf) ? `${weekdayOf(closesAt)} ${clockOf(closesAt)}` : dayMonthOf(closesAt)}`;

/** The one fact that says where a listed tournament stands, if any. */
export function listedFact(
  lobby: Extract<ListedLobby, { kind: 'tournament' }>,
  asOf: string,
): string | null {
  if (lobby.finish !== null)
    return lobby.finish.viewer === null
      ? `won by ${lobby.finish.winner}`
      : `you finished ${ordinalOf(lobby.finish.viewer.place)} of ${lobby.finish.viewer.of}`;
  const now = lobby.now;
  if (now !== null)
    switch (now.kind) {
      case 'round_opens':
        return `${now.tabRoundName} opens ${clockOf(now.at)}`;
      case 'break_at':
        return `the break is announced at ${clockOf(now.at)}`;
      case 'live':
        return `${now.tabRoundName} live`;
    }
  if (lobby.status !== 'open' || lobby.entry.opensAt !== null) return null;
  return lobby.entry.eligibility === 'anyone' && lobby.entry.capacity !== null
    ? `${lobby.entry.taken} of ${lobby.entry.capacity} places taken`
    : entryClosesPhrase(lobby.entry.closesAt, asOf);
}

/** What the viewer is doing there, in a few words. */
export function partWords(
  part: Extract<ListedLobby, { kind: 'tournament' }>['part'],
): string | null {
  if (part === null) return null;
  switch (part.kind) {
    case 'host':
      return 'you are the host';
    case 'competitor':
      return listed(part.events);
    case 'judge':
      return `judging ${listed(part.events)}`;
    case 'school':
      return `${part.school}'s entries`;
    case 'guardian':
      return listed(part.wards);
  }
}

/** The tournaments index: the viewer's own first, then what is open. */
export function tournamentsIndexOf(
  page: LobbyListPage,
  addressOf: AddressOf,
): TournamentsIndex {
  const tournaments = page.lobbies.flatMap((lobby) =>
    lobby.kind === 'tournament' ? [lobby] : [],
  );
  const when = (lobby: (typeof tournaments)[number]) =>
    lobby.status === 'running'
      ? 'Today'
      : lobby.status === 'completed'
        ? dayMonthOf(lobby.startsAt)
        : lobby.owner.kind === 'person'
          ? `${shortDateOf(lobby.startsAt)}, ${clockOf(lobby.startsAt)}`
          : shortDateOf(lobby.startsAt);
  const open = (lobby: (typeof tournaments)[number]) =>
    addressOf({ kind: 'tournament', handle: lobby.handle });
  const row = (lobby: (typeof tournaments)[number]): TournamentRow => {
    const fact = listedFact(lobby, page.asOf);
    const part = partWords(lobby.part);
    const detail =
      lobby.status === 'completed'
        ? [when(lobby), ownerWords(lobby), fact]
        : fact === null
          ? [when(lobby), ownerWords(lobby), part]
          : [when(lobby), part ?? ownerWords(lobby), fact];
    return {
      name: lobby.name,
      detail: detail.filter((one) => one !== null).join(' · '),
      action:
        lobby.status === 'completed'
          ? actionTo('Results', open(lobby))
          : lobby.part !== null
            ? actionTo('Open', open(lobby), fact !== null)
            : actionTo('View', open(lobby)),
    };
  };
  const group = (
    heading: string,
    rows: readonly (typeof tournaments)[number][],
    more: TabAction | null = null,
  ): TournamentGroup[] =>
    rows.length === 0 ? [] : [{ heading, rows: rows.map(row), more }];
  const active = tournaments.filter((lobby) => lobby.status !== 'completed');
  return {
    groups: [
      ...group(
        "You're in",
        active.filter((lobby) => lobby.part !== null),
      ),
      ...group(
        'On now',
        active.filter(
          (lobby) => lobby.part === null && lobby.status === 'running',
        ),
      ),
      ...group(
        'Open to enter',
        active.filter(
          (lobby) => lobby.part === null && lobby.status !== 'running',
        ),
      ),
      ...group(
        'Recent',
        tournaments.filter((lobby) => lobby.status === 'completed'),
        actionTo(
          'All past tournaments',
          addressOf({ kind: 'past_tournaments' }),
        ),
      ),
    ],
    host:
      page.capabilities?.createLobby === true
        ? linkTo('Host a tournament', hostRoutes.home)
        : null,
  };
}

export const readTimelineRail = (
  slug: string,
  scene: SampleScene,
): TimelineRail | null => {
  const lobby = sampleTimelineRead(slug, scene);
  return lobby === null ? null : timelineRailOf(lobby, sampleAddressOf);
};

export const readTournamentPage = (
  slug: string,
  view: TournamentView,
  scene: SampleScene,
): TournamentPage | null => {
  const reads = sampleTournamentReads(slug, view, scene);
  return reads === null ? null : tournamentPageOf(reads, view, sampleAddressOf);
};

export const readTournamentsIndex = (scene: SampleScene): TournamentsIndex =>
  tournamentsIndexOf(sampleTournamentListRead(scene), sampleAddressOf);

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
  const open = rail.items.filter(
    (item) => item.action !== null && item.action.href !== null,
  );
  const wanted = urgency
    .map((kind) => open.find((item) => item.standing?.kind === kind))
    .find((item) => item !== undefined);
  const last = open.at(-1);
  const rest = last?.standing?.kind === 'done' ? last : open[0];
  return (wanted ?? rest)?.action?.href ?? null;
}
