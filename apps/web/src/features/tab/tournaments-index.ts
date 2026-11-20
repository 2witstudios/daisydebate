import { tournamentMonthSchema } from '@daisy/protocol/lobby/lobby-read';
import type {
  ListedLobby,
  LobbyListPage,
  LobbyListQuery,
  LobbyListTab,
} from '@daisy/protocol/lobby/lobby-read';
import {
  tournamentDivisions,
  type TournamentDivision,
} from '@daisy/protocol/lobby';
import { linkTo, type TabAction } from './action';
import { hostRoutes, tabRoutes } from './routes';
import {
  actionTo,
  clockOf,
  dayMonthOf,
  listedFact,
  ownerWords,
  partWords,
  shortDateOf,
  type AddressOf,
} from './tournament';

/** A location supplied by the index reader for distance filtering. */
export type IndexPlace = {
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
};

type Listed = Extract<ListedLobby, { kind: 'tournament' }>;

/** The address's query, as the page receives it. */
export type IndexParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

type IndexView = 'list' | 'calendar';
type IndexMode = 'online' | 'in_person';

/** Everything the index's address carries. Absent narrows nothing. */
export type IndexState = {
  readonly q: string;
  readonly format: string | null;
  readonly league: string | null;
  readonly division: TournamentDivision | null;
  readonly mode: IndexMode | null;
  /** A city the reader is near; in person only. */
  readonly near: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly open: boolean;
  readonly view: IndexView;
  readonly tab: LobbyListTab;
  readonly month: string | null;
  readonly day: string | null;
  /** Rows shown; null for the first page. */
  readonly shown: number | null;
};

/** One tournament as the index lists it. */
export type IndexRow = {
  readonly name: string;
  /** `Sat`, `21`: the desktop row's date stamp. */
  readonly weekday: string;
  readonly date: string;
  /** The league, or who hosts it. */
  readonly owner: string;
  /** Events, in full: `Lincoln-Douglas, Public Forum`. */
  readonly events: string;
  readonly divisions: string;
  /** `Online` or `In person`, then `from anywhere` or the city. */
  readonly venue: readonly [string, string];
  /** The phone's one line under the name. */
  readonly detail: string;
  readonly entry: {
    readonly label: string;
    readonly tone: 'open' | 'quiet';
  };
  readonly action: TabAction;
};

/** Rows under one day or one week, with how many the results hold there. */
export type RowGroup = {
  readonly heading: string;
  readonly count: number;
  readonly rows: readonly IndexRow[];
};

type FilterChip = {
  readonly label: string;
  /** The address without this filter. */
  readonly remove: string;
};

export type IndexOption = readonly [value: string, label: string];

type IndexTabLink = {
  readonly id: LobbyListTab;
  readonly label: string;
  readonly count: number | null;
  readonly href: string;
  readonly selected: boolean;
};

/** A page of rows and the control for the next. */
export type IndexPaging = {
  /** `20 of 128 shown`. */
  readonly summary: string;
  readonly more: { readonly label: string; readonly href: string } | null;
};

export type CalendarDay = {
  readonly date: string;
  readonly number: number;
  readonly inMonth: boolean;
  readonly past: boolean;
  readonly today: boolean;
  readonly selected: boolean;
  readonly count: number;
  /** Null for a day with nothing on it. */
  readonly href: string | null;
};

export type IndexCalendar = {
  /** `November 2026`. */
  readonly title: string;
  readonly previous: string | null;
  readonly next: string | null;
  readonly weeks: readonly (readonly CalendarDay[])[];
  /** The chosen day's tournaments; null when none is chosen. */
  readonly day: {
    readonly heading: string;
    readonly count: number;
    readonly rows: readonly IndexRow[];
    readonly paging: IndexPaging;
  } | null;
};

type IndexList = {
  /** `128 tournaments, soonest first`. */
  readonly summary: string;
  /** The phone's grouping. */
  readonly days: readonly RowGroup[];
  /** The desktop's grouping. */
  readonly weeks: readonly RowGroup[];
  readonly paging: IndexPaging;
};

/** The tournaments index: the viewer's own pinned, then every tournament found. */
export type TournamentsIndex = {
  readonly state: IndexState;
  /** The viewer's own running and coming tournaments, whatever the filters. */
  readonly yours: readonly IndexRow[];
  readonly views: {
    readonly list: string;
    readonly calendar: string;
  };
  readonly tabs: readonly IndexTabLink[];
  readonly chips: readonly FilterChip[];
  /** The address with no filters, or null when none is set. */
  readonly clear: string | null;
  /** Filters set, for the Filters control's count (the search is not one). */
  readonly active: number;
  /** Tournaments the current filters find in this view. */
  readonly found: number;
  readonly options: {
    readonly formats: readonly IndexOption[];
    readonly leagues: readonly IndexOption[];
    readonly divisions: readonly IndexOption[];
    readonly modes: readonly IndexOption[];
    readonly near: readonly IndexOption[];
  };
  readonly list: IndexList | null;
  readonly calendar: IndexCalendar | null;
  /** Null for a signed-out reader. */
  readonly host: TabAction | null;
};

const indexPageSize = 20;
/** A calendar day lists this many before "Show all". */
const dayPageSize = 5;
/** How far "near me" reaches. */
const nearMiles = 50;

const formats = [
  'Lincoln-Douglas',
  'Public Forum',
  'Policy',
  'Parli',
  'British Parliamentary',
  'Congress',
  'Extemp',
  'Impromptu',
  'Oratory',
  'Interp',
] as const;

/** The short names events go by: `Varsity LD` is Lincoln-Douglas. */
const shortFormats: Readonly<Record<string, string>> = {
  'Lincoln-Douglas': 'LD',
  'Public Forum': 'PF',
  'British Parliamentary': 'BP',
};

const divisionLabels: Readonly<Record<TournamentDivision, string>> = {
  novice: 'Novice',
  jv: 'JV',
  varsity: 'Varsity',
  open: 'Open',
};

const modeLabels: Readonly<Record<IndexMode, string>> = {
  online: 'Online',
  in_person: 'In person',
};

const tabLabels: Readonly<Record<LobbyListTab, string>> = {
  upcoming: 'Upcoming',
  live: 'Live now',
  past: 'Past',
};

// Reading the address.

const first = (
  value: string | readonly string[] | undefined,
): string | undefined =>
  (typeof value === 'string' ? value : value?.[0])?.trim() || undefined;

const isDay = (value: string | undefined): value is string =>
  value !== undefined &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);
const isMonth = (value: string | undefined): value is string =>
  value !== undefined && tournamentMonthSchema.safeParse(value).success;
const oneOf = <T extends string>(
  values: readonly T[],
  value: string | undefined,
): T | null =>
  ((values as readonly string[]).find((one) => one === value) as T | null) ??
  null;

const named = (value: string | undefined): string | null =>
  value === undefined ? null : value.slice(0, 200);

/**
 * The index's state from its address. Anything unknown reads as unset, so a
 * hand-edited address never fails; near me is in person only.
 */
export function indexStateOf(
  params: IndexParams,
  places: readonly IndexPlace[] = [],
): IndexState {
  const mode = oneOf<IndexMode>(['online', 'in_person'], first(params.mode));
  const near = first(params.near);
  const from = first(params.from);
  const to = first(params.to);
  const shown = Number(first(params.shown));
  const day = first(params.day);
  const month = first(params.month);
  return {
    q: (first(params.q) ?? '').slice(0, 100),
    format: named(first(params.format)),
    league: named(first(params.league)),
    division: oneOf(tournamentDivisions, first(params.division)),
    mode,
    near:
      mode !== 'online' && places.some((place) => place.city === near)
        ? (near ?? null)
        : null,
    from: isDay(from) ? from : null,
    to: isDay(to) && !(isDay(from) && to < from) ? to : null,
    open: first(params.open) === '1',
    view: first(params.view) === 'calendar' ? 'calendar' : 'list',
    tab:
      oneOf<LobbyListTab>(['upcoming', 'live', 'past'], first(params.tab)) ??
      'upcoming',
    month: isMonth(month) ? month : null,
    day: isDay(day) ? day : null,
    shown: Number.isInteger(shown) && shown > 0 && shown <= 1000 ? shown : null,
  };
}

/** The address of one state: defaults left out, so each state has one address. */
export function indexHref(state: IndexState): string {
  const pairs: [string, string | null][] = [
    ['q', state.q === '' ? null : state.q],
    ['format', state.format],
    ['league', state.league],
    ['division', state.division],
    ['mode', state.mode],
    ['near', state.near],
    ['from', state.from],
    ['to', state.to],
    ['open', state.open ? '1' : null],
    ['view', state.view === 'calendar' ? 'calendar' : null],
    [
      'tab',
      state.view === 'list' && state.tab !== 'upcoming' ? state.tab : null,
    ],
    ['month', state.view === 'calendar' ? state.month : null],
    ['day', state.view === 'calendar' ? state.day : null],
    ['shown', state.shown === null ? null : String(state.shown)],
  ];
  const query = new URLSearchParams(
    pairs.flatMap(([key, value]) => (value === null ? [] : [[key, value]])),
  ).toString();
  return query === ''
    ? tabRoutes.tournaments
    : `${tabRoutes.tournaments}?${query}`;
}

const noFilters = {
  q: '',
  format: null,
  league: null,
  division: null,
  mode: null,
  near: null,
  from: null,
  to: null,
  open: false,
} as const;

/**
 * What the lobby list read is asked for one state: the contract's query.
 * The calendar asks for its month's counts and its day's tournaments.
 */
export function lobbyListQueryOf(state: IndexState): LobbyListQuery {
  const pageSize = state.view === 'calendar' ? dayPageSize : indexPageSize;
  const shown = state.shown ?? pageSize;
  return {
    q: state.q,
    ...(state.format === null ? {} : { format: state.format }),
    ...(state.league === null ? {} : { league: state.league }),
    ...(state.division === null ? {} : { division: state.division }),
    ...(state.mode === null ? {} : { mode: state.mode }),
    ...(state.near === null
      ? {}
      : { near: { place: state.near, miles: nearMiles } }),
    ...(state.from === null ? {} : { from: state.from }),
    ...(state.to === null ? {} : { to: state.to }),
    ...(state.open ? { open: true } : {}),
    tab: state.tab,
    ...(state.view === 'calendar' && state.month !== null
      ? { month: state.month }
      : {}),
    ...(state.view === 'calendar' && state.day !== null
      ? { day: state.day }
      : {}),
    offset: 0,
    pageSize: Math.min(shown, 1000),
  };
}

// Dates. Instants are UTC and a tournament's day is read in UTC.

const dayMs = 24 * 60 * 60 * 1000;
const dayOf = (at: string): string => at.slice(0, 10);
const instantOf = (day: string): string => `${day}T00:00:00.000Z`;
const addDays = (day: string, by: number): string =>
  dayOf(new Date(Date.parse(instantOf(day)) + by * dayMs).toISOString());
const weekdayIndex = (day: string): number =>
  new Date(instantOf(day)).getUTCDay();
const monthOfDay = (day: string): string => day.slice(0, 7);
const addMonths = (month: string, by: number): string => {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 7);
};
const monthTitle = (month: string): string =>
  new Date(`${month}-01T00:00:00.000Z`).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** `15 to 21 Nov`, or `29 Nov to 5 Dec` across a month. */
const weekHeading = (sunday: string): string => {
  const saturday = addDays(sunday, 6);
  const start = dayMonthOf(instantOf(sunday));
  const end = dayMonthOf(instantOf(saturday));
  return monthOfDay(sunday) === monthOfDay(saturday)
    ? `${start.split(' ')[0] ?? ''} to ${end}`
    : `${start} to ${end}`;
};

/** Great-circle miles between two points. */
const milesBetween = (
  a: { readonly latitude: number; readonly longitude: number },
  b: { readonly latitude: number; readonly longitude: number },
): number => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
};

// Filtering.

const tabOf = (lobby: Listed): LobbyListTab =>
  lobby.status === 'running'
    ? 'live'
    : lobby.status === 'completed'
      ? 'past'
      : 'upcoming';

/** Whether a tournament takes entries now, with a place left. */
const entryOpen = (lobby: Listed, asOf: string): boolean =>
  lobby.status === 'open' &&
  lobby.entry.opensAt === null &&
  lobby.entry.closesAt > asOf &&
  (lobby.entry.capacity === null || lobby.entry.taken < lobby.entry.capacity);

const ownerName = (lobby: Listed): string =>
  lobby.owner.kind === 'organization' ? lobby.owner.name : lobby.owner.username;

const runsFormat = (lobby: Listed, format: string): boolean => {
  const short = shortFormats[format];
  return lobby.events.some(
    (event) =>
      event.toLowerCase().includes(format.toLowerCase()) ||
      (short !== undefined && event.split(/\s+/).includes(short)),
  );
};

/** Whether a tournament passes every filter of a state. */
function matches(
  lobby: Listed,
  state: IndexState,
  asOf: string,
  places: readonly IndexPlace[] = [],
): boolean {
  const q = state.q.toLowerCase();
  const day = dayOf(lobby.startsAt);
  const near = places.find((place) => place.city === state.near);
  return (
    (q === '' ||
      [lobby.name, ownerName(lobby), lobby.hostedBy ?? ''].some((text) =>
        text.toLowerCase().includes(q),
      )) &&
    (state.format === null || runsFormat(lobby, state.format)) &&
    (state.league === null ||
      (lobby.owner.kind === 'organization' &&
        lobby.owner.name === state.league)) &&
    (state.division === null || lobby.divisions.includes(state.division)) &&
    (state.mode === null || lobby.venue.place === state.mode) &&
    (near === undefined ||
      (lobby.venue.place === 'in_person' &&
        milesBetween(near, lobby.venue) <= nearMiles)) &&
    (state.from === null || day >= state.from) &&
    (state.to === null || day <= state.to) &&
    (!state.open || entryOpen(lobby, asOf))
  );
}

// Rows.

const placeShort = (lobby: Listed): string =>
  lobby.venue.place === 'online'
    ? 'Online'
    : (lobby.venue.city.split(',')[0] ?? lobby.venue.city);

const shortEvents = (lobby: Listed): string =>
  lobby.events.map((event) => shortFormats[event] ?? event).join(', ');

function entryOf(lobby: Listed, asOf: string): IndexRow['entry'] {
  const quiet = (label: string) => ({ label, tone: 'quiet' as const });
  const open = (label: string) => ({ label, tone: 'open' as const });
  if (lobby.status === 'running') return open('Live');
  if (lobby.finish !== null) return quiet(`Won by ${lobby.finish.winner}`);
  if (lobby.status === 'completed') return quiet('Finished');
  const { opensAt, closesAt, capacity, taken } = lobby.entry;
  if (opensAt !== null) return quiet(`Entry opens ${dayMonthOf(opensAt)}`);
  if (closesAt <= asOf) return quiet('Entry closed');
  if (capacity !== null && taken >= capacity) return quiet('Waitlist');
  if (dayOf(closesAt) === dayOf(asOf)) return open('Closes today');
  return capacity !== null && capacity - taken <= 8
    ? open(`${taken} of ${capacity} places`)
    : open('Entry open');
}

function rowOf(lobby: Listed, asOf: string, addressOf: AddressOf): IndexRow {
  const href = addressOf({ kind: 'tournament', handle: lobby.handle });
  const owner = ownerWords(lobby);
  return {
    name: lobby.name,
    weekday: shortDateOf(lobby.startsAt).slice(0, 3),
    date: String(new Date(lobby.startsAt).getUTCDate()),
    owner,
    events: lobby.events.join(', '),
    divisions: lobby.divisions.map((one) => divisionLabels[one]).join(', '),
    venue:
      lobby.venue.place === 'online'
        ? ['Online', 'from anywhere']
        : ['In person', lobby.venue.city],
    detail: [owner, shortEvents(lobby), placeShort(lobby)]
      .filter((one) => one !== '')
      .join(' · '),
    entry: entryOf(lobby, asOf),
    action:
      lobby.status === 'completed'
        ? actionTo('Results', href)
        : lobby.part !== null
          ? actionTo('Open', href)
          : actionTo('View', href),
  };
}

/** A pinned row: when, then what the viewer is doing or where it stands. */
function yourRow(lobby: Listed, asOf: string, addressOf: AddressOf): IndexRow {
  const row = rowOf(lobby, asOf, addressOf);
  const when =
    lobby.status === 'running'
      ? 'Today'
      : lobby.owner.kind === 'person'
        ? `${shortDateOf(lobby.startsAt)}, ${clockOf(lobby.startsAt)}`
        : shortDateOf(lobby.startsAt);
  const fact = listedFact(lobby, asOf);
  const part = partWords(lobby.part);
  const said = lobby.status === 'running' ? fact : (part ?? fact);
  return {
    ...row,
    detail: [when, said].filter((one) => one !== null).join(' · '),
    action: actionTo(
      'Open',
      addressOf({ kind: 'tournament', handle: lobby.handle }),
      lobby.status === 'running',
    ),
  };
}

function grouped(
  rows: readonly { readonly lobby: Listed; readonly row: IndexRow }[],
  all: readonly Listed[],
  keyOf: (lobby: Listed) => string,
  headingOf: (key: string) => string,
): RowGroup[] {
  const counts = new Map<string, number>();
  for (const lobby of all)
    counts.set(keyOf(lobby), (counts.get(keyOf(lobby)) ?? 0) + 1);
  const groups: { key: string; rows: IndexRow[] }[] = [];
  for (const { lobby, row } of rows) {
    const key = keyOf(lobby);
    const last = groups.at(-1);
    if (last?.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups.map((group) => ({
    heading: headingOf(group.key),
    count: counts.get(group.key) ?? group.rows.length,
    rows: group.rows,
  }));
}

const weekOf = (lobby: Listed): string => {
  const day = dayOf(lobby.startsAt);
  return addDays(day, -weekdayIndex(day));
};

const paged = (
  noun: string,
  shown: number,
  total: number,
  next: (shown: number) => string,
  all: boolean,
): IndexPaging => ({
  summary: `${shown} of ${total} ${noun}`,
  more:
    shown >= total
      ? null
      : all
        ? { label: `Show all ${total}`, href: next(total) }
        : {
            label: `Show ${Math.min(indexPageSize, total - shown)} more`,
            href: next(Math.min(total, shown + indexPageSize)),
          },
});

const sortedFor = (tab: LobbyListTab, lobbies: readonly Listed[]) =>
  [...lobbies].sort((a, b) =>
    tab === 'past'
      ? b.startsAt.localeCompare(a.startsAt) || a.name.localeCompare(b.name)
      : a.startsAt.localeCompare(b.startsAt) || a.name.localeCompare(b.name),
  );

function chipsOf(state: IndexState): FilterChip[] {
  const without = (change: Partial<IndexState>) =>
    indexHref({ ...state, ...change, shown: null });
  const chip = (label: string, change: Partial<IndexState>) => ({
    label,
    remove: without(change),
  });
  return [
    ...(state.q === '' ? [] : [chip(`“${state.q}”`, { q: '' })]),
    ...(state.format === null ? [] : [chip(state.format, { format: null })]),
    ...(state.league === null ? [] : [chip(state.league, { league: null })]),
    ...(state.division === null
      ? []
      : [chip(divisionLabels[state.division], { division: null })]),
    ...(state.mode === null
      ? []
      : [
          chip(
            modeLabels[state.mode],
            state.mode === 'in_person'
              ? { mode: null, near: null }
              : { mode: null },
          ),
        ]),
    ...(state.near === null
      ? []
      : [chip(`Within ${nearMiles} miles of ${state.near}`, { near: null })]),
    ...(state.from === null
      ? []
      : [chip(`From ${dayMonthOf(instantOf(state.from))}`, { from: null })]),
    ...(state.to === null
      ? []
      : [chip(`To ${dayMonthOf(instantOf(state.to))}`, { to: null })]),
    ...(state.open ? [chip('Entry open', { open: false })] : []),
  ];
}

function calendarOf(
  state: IndexState,
  found: readonly Listed[],
  every: readonly Listed[],
  asOf: string,
  addressOf: AddressOf,
): IndexCalendar {
  const today = dayOf(asOf);
  const requestedMonth = state.month ?? undefined;
  const month = isMonth(requestedMonth) ? requestedMonth : monthOfDay(today);
  const counts = new Map<string, number>();
  // The calendar is for what is coming: a day gone by is grey, uncounted.
  for (const lobby of found) {
    const day = dayOf(lobby.startsAt);
    if (day >= today) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const inMonth = (day: string) => monthOfDay(day) === month;
  const chosen =
    state.day !== null && inMonth(state.day)
      ? state.day
      : inMonth(today)
        ? today
        : ([...counts.keys()].filter(inMonth).sort()[0] ?? null);
  const at = (change: Partial<IndexState>) =>
    indexHref({ ...state, ...change, view: 'calendar', shown: null });
  // A month's address leaves out the day, so each day has one address.
  const dayHref = (day: string) =>
    at({
      month: monthOfDay(day) === monthOfDay(today) ? null : monthOfDay(day),
      day: day === today ? null : day,
    });
  const monthHref = (to: string) =>
    at({ month: to === monthOfDay(today) ? null : to, day: null });
  const earliest = monthOfDay(today);
  const latest =
    [...every.map((lobby) => monthOfDay(dayOf(lobby.startsAt))), earliest]
      .sort()
      .at(-1) ?? earliest;
  const start = addDays(`${month}-01`, -weekdayIndex(`${month}-01`));
  const weeks: CalendarDay[][] = [];
  let day = start;
  for (
    let weekNumber = 0;
    weekNumber < 6 && (inMonth(day) || day < `${month}-01`);
    weekNumber++
  ) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i += 1, day = addDays(day, 1)) {
      const count = inMonth(day) ? (counts.get(day) ?? 0) : 0;
      week.push({
        date: day,
        number: Number(day.slice(8)),
        inMonth: inMonth(day),
        past: day < today,
        today: day === today,
        selected: day === chosen,
        count,
        href: count === 0 || day === chosen ? null : dayHref(day),
      });
    }
    weeks.push(week);
  }
  const onDay =
    chosen === null
      ? []
      : sortedFor(
          'upcoming',
          found.filter((lobby) => dayOf(lobby.startsAt) === chosen),
        );
  const shown = Math.min(onDay.length, state.shown ?? dayPageSize);
  return {
    title: monthTitle(month),
    previous: month > earliest ? monthHref(addMonths(month, -1)) : null,
    next: month < latest ? monthHref(addMonths(month, 1)) : null,
    weeks,
    day:
      chosen === null
        ? null
        : {
            heading: shortDateOf(instantOf(chosen)),
            count: onDay.length,
            rows: onDay
              .slice(0, shown)
              .map((lobby) => rowOf(lobby, asOf, addressOf)),
            paging: paged(
              'shown',
              shown,
              onDay.length,
              (next) =>
                indexHref({
                  ...state,
                  view: 'calendar',
                  month:
                    monthOfDay(chosen) === monthOfDay(today)
                      ? null
                      : monthOfDay(chosen),
                  day: chosen === today ? null : chosen,
                  shown: next,
                }),
              true,
            ),
          },
  };
}

/**
 * The tournaments index from the lobby list and the address's state: the
 * viewer's own pinned, then what the filters find, by tab and paged, or by
 * day on a month's calendar. Pure: the read answers every listed tournament
 * and this filters and pages them, as the read will once it is real.
 */
export function tournamentsIndexOf(
  page: LobbyListPage,
  state: IndexState,
  addressOf: AddressOf,
  places: readonly IndexPlace[] = [],
): TournamentsIndex {
  const every = page.lobbies.flatMap((lobby) =>
    lobby.kind === 'tournament' ? [lobby] : [],
  );
  const asOf = page.asOf;
  const found = every.filter((lobby) => matches(lobby, state, asOf, places));
  const inTab = (tab: LobbyListTab) =>
    found.filter((lobby) => tabOf(lobby) === tab);
  const listed = sortedFor(state.tab, inTab(state.tab));
  const filtersSet = chipsOf(state).length;
  const leagues = [
    ...new Set(
      every.flatMap((lobby) =>
        lobby.owner.kind === 'organization' ? [lobby.owner.name] : [],
      ),
    ),
  ].sort();
  const list = (): IndexList => {
    const shown = Math.min(listed.length, state.shown ?? indexPageSize);
    const rows = listed
      .slice(0, shown)
      .map((lobby) => ({ lobby, row: rowOf(lobby, asOf, addressOf) }));
    return {
      summary: `${listed.length} tournament${listed.length === 1 ? '' : 's'}, ${state.tab === 'past' ? 'most recent' : 'soonest'} first`,
      days: grouped(
        rows,
        listed,
        (lobby) => dayOf(lobby.startsAt),
        (day) => shortDateOf(instantOf(day)),
      ),
      weeks: grouped(rows, listed, weekOf, weekHeading),
      paging: paged(
        'shown',
        shown,
        listed.length,
        (next) => indexHref({ ...state, shown: next }),
        false,
      ),
    };
  };
  return {
    state,
    yours: sortedFor(
      'upcoming',
      every.filter(
        (lobby) => lobby.part !== null && lobby.status !== 'completed',
      ),
    ).map((lobby) => yourRow(lobby, asOf, addressOf)),
    views: {
      list: indexHref({
        ...state,
        view: 'list',
        month: null,
        day: null,
        shown: null,
      }),
      calendar: indexHref({
        ...state,
        view: 'calendar',
        tab: 'upcoming',
        shown: null,
      }),
    },
    tabs: (['upcoming', 'live', 'past'] as const).map((tab) => ({
      id: tab,
      label: tabLabels[tab],
      count: tab === 'past' ? null : inTab(tab).length,
      href: indexHref({ ...state, tab, shown: null }),
      selected: state.tab === tab,
    })),
    chips: chipsOf(state),
    clear:
      filtersSet === 0
        ? null
        : indexHref({ ...state, ...noFilters, shown: null }),
    active: filtersSet - (state.q === '' ? 0 : 1),
    found: state.view === 'calendar' ? found.length : listed.length,
    options: {
      formats: [
        ['', 'Any format or event'],
        ...formats.map((one) => [one, one] as const),
      ],
      leagues: [
        ['', 'Any league'],
        ...leagues.map((one) => [one, one] as const),
      ],
      divisions: [
        ['', 'Any division'],
        ...tournamentDivisions.map(
          (one) => [one, divisionLabels[one]] as const,
        ),
      ],
      modes: [
        ['', 'Online or in person'],
        ['online', 'Online'],
        ['in_person', 'In person'],
      ],
      near: [
        ['', 'Near me: anywhere'],
        ...[...places]
          .sort((a, b) => a.city.localeCompare(b.city))
          .map(
            (place) =>
              [
                place.city,
                `Within ${nearMiles} miles of ${place.city}`,
              ] as const,
          ),
      ],
    },
    list: state.view === 'list' ? list() : null,
    calendar:
      state.view === 'calendar'
        ? calendarOf(state, found, every, asOf, addressOf)
        : null,
    host:
      page.capabilities?.createLobby === true
        ? linkTo('Host a tournament', hostRoutes.home)
        : null,
  };
}
