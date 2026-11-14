import type { Choice, TabAction } from './action';
import type { OrganizationView } from '@daisy/protocol/lobby/organization-read';
import type { ResolvedSettingsView } from '@daisy/protocol/lobby/resolved-settings-read';
import type {
  Sanction,
  SanctionList,
  SeasonTournament,
  SeasonView,
} from '@daisy/protocol/lobby/season-read';
import type {
  TemplateSettingRow,
  TemplateView,
} from '@daisy/protocol/lobby/template-read';
import type { SettingKey } from '@daisy/protocol/setting-values';
import { linkTo, sampleAction } from './action';
import { dayWords, isSameDay, monthWords } from './organization';
import { resolvedEntry } from './reads/resolved-settings';
import { hostRoutes, tabRoutes } from './routes';
import {
  sampleHostLeagueCopy,
  sampleLeagueLobbySettings,
  sampleLeagueView,
  sampleSanctionList,
  sampleSeasonView,
  sampleVarsityTemplate,
} from './sample/league';
import { sampleCreateRoom } from './sample/create-room';
import { sampleHostAddress, sampleNow } from './sample/organization';
import {
  lockedSetting,
  openSetting,
  settingLineOf,
  type SettingLine,
  type SettingLineCopy,
} from './settings';
import type {
  LobbyLadder,
  LobbyListPage,
  LobbyRoomList,
  StandingLobbyView,
} from '@daisy/protocol/lobby/lobby-read';
import {
  sampleLadder,
  sampleLeagueTournaments,
  sampleLobbyRooms,
  sampleSeasonPanel,
  sampleStandingLobby,
} from './sample/league-lobby';
import { sampleAddressOf } from './sample/tournament';
import {
  actionTo,
  capitalized,
  dayMonthOf,
  listed,
  listedFact,
  monthOf,
  numberWord,
  ordinalOf,
  shortDateOf,
  type AddressOf,
} from './tournament';
import type { SampleScene } from './sample/scene';
import type { RailItem, TimelineRail, TournamentGroup } from './tournament';
import type { LeagueTab } from './routes';

export type SeasonRow = {
  readonly place: number;
  readonly name: string;
  readonly school: string;
  readonly points: number;
  /** The viewer's own line, pinned first and marked. */
  readonly you: boolean;
};

/** An event asking a league to count its certified results for the season. */
export type SanctionRequest = {
  readonly event: string;
  readonly facts: string;
  /** The computed check: every enforced value equals the event's own. */
  readonly meets: string;
  readonly decline: TabAction;
  readonly sanction: TabAction;
};

export type HostLeague = {
  readonly name: string;
  readonly lede: string;
  readonly lobbyView: TabAction;
  readonly requests: readonly SanctionRequest[];
  readonly template: {
    readonly name: string;
    readonly settings: readonly SettingLine[];
    readonly edit: TabAction;
    readonly note: string;
  };
  readonly season: {
    readonly heading: string;
    readonly rows: readonly SeasonRow[];
    readonly note: string;
    readonly rule: TabAction;
  };
  readonly ladder: { readonly detail: string; readonly open: TabAction };
  readonly lobby: readonly SettingLine[];
};

export type LobbyRoomRow = {
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction;
};

export type LadderRow = {
  readonly place: number;
  readonly name: string;
  readonly school: string;
  /** Wins and losses on this ladder, e.g. `14–9`. */
  readonly record: string;
  readonly rating: number;
  /** The rating's change over the last rated Room. */
  readonly change: number;
  readonly you: boolean;
  readonly profile: TabAction;
};

export type LadderScope = 'top' | 'around';

/** One tab of a league's lobby, with what its address chose on it. */
export type LeagueView =
  | { readonly tab: 'rooms' }
  | {
      readonly tab: 'ladder';
      readonly scope: LadderScope;
      readonly search: string;
    }
  | { readonly tab: 'season'; readonly event: string | null }
  | { readonly tab: 'tournaments' };

export type LeaguePanel =
  | {
      readonly kind: 'rooms';
      readonly pool: { readonly title: string; readonly detail: string };
      readonly groups: readonly {
        readonly heading: string;
        readonly rooms: readonly LobbyRoomRow[];
      }[];
      readonly note: string;
    }
  | {
      readonly kind: 'ladder';
      /** Where the scope and search are sent: this tab's own address. */
      readonly address: string;
      readonly scope: LadderScope;
      readonly search: string;
      readonly rows: readonly LadderRow[];
      readonly count: string;
      readonly next: TabAction | null;
      readonly note: string;
      readonly rules: TabAction;
    }
  | {
      readonly kind: 'season';
      readonly address: string;
      readonly season: string;
      readonly events: readonly {
        readonly slug: string;
        readonly name: string;
      }[];
      readonly event: string;
      readonly rows: readonly SeasonRow[];
      readonly all: TabAction;
      readonly points: readonly {
        readonly label: string;
        readonly points: number;
      }[];
      readonly note: string;
      readonly tournaments: TabAction;
    }
  | {
      readonly kind: 'tournaments';
      readonly groups: readonly TournamentGroup[];
      readonly note: string;
    };

/** A league's standing lobby, as one of its members sees it. */
export type LeagueLobby = {
  readonly name: string;
  readonly lede: string;
  /** Null for someone who is not a member: only members open rooms here. */
  readonly create: TabAction | null;
  readonly tabs: readonly {
    readonly id: LeagueTab;
    readonly label: string;
    readonly href: string;
    readonly selected: boolean;
  }[];
  readonly panel: LeaguePanel;
};

/**
 * The create-room form of a standing lobby: the resolved settings of the
 * template the Room follows. Enforced values are locked; defaults are
 * prefilled and may be changed.
 */
export type CreateRoom = {
  readonly lobby: { readonly name: string; readonly href: string };
  readonly name: string;
  readonly templates: readonly {
    readonly name: string;
    readonly detail: string;
  }[];
  readonly template: string;
  /** Who enforces the locked values: the organization that owns the template. */
  readonly lockedBy: string;
  readonly locked: readonly SettingLine[];
  readonly defaults: readonly Choice[];
  readonly ranked: {
    readonly label: string;
    readonly detail: string;
    readonly checked: boolean;
  };
  readonly open: TabAction;
};

const opens = (label: string, address: string | null): TabAction =>
  address === null ? sampleAction(label) : linkTo(label, address);

/** How a tournament on the season's calendar stands, as the rail says it. */
const calendarStanding = (
  tournament: SeasonTournament,
  now: string,
): RailItem['standing'] => {
  if (tournament.completed) return { kind: 'done' };
  if (tournament.sanction === 'requested')
    return { kind: 'note', text: 'asks to count' };
  if (tournament.when.precision === 'month')
    return { kind: 'note', text: monthWords(tournament.when.month) };
  return {
    kind: 'note',
    text: isSameDay(tournament.when.startsAt, now)
      ? 'today'
      : dayWords(tournament.when.startsAt),
  };
};

/**
 * A league's host rail: its season's tournaments in order, each opening its
 * host pages, or the league page where its sanction request waits.
 */
export function leagueRailOf(
  season: SeasonView,
  league: { readonly handle: string },
  now: string,
  addressOf: (lobby: { readonly handle: string }) => string | null,
): TimelineRail {
  const stop = (
    id: string,
    label: string,
    standing: RailItem['standing'],
    action: TabAction | null,
  ): RailItem => ({ id, label, time: null, standing, action });
  return {
    title: season.organization.name,
    subtitle: season.name,
    heading: null,
    footHeading: null,
    items: season.calendar.map((tournament) =>
      stop(
        tournament.handle,
        tournament.name,
        calendarStanding(tournament, now),
        opens(
          tournament.name,
          tournament.sanction === 'requested' && !tournament.completed
            ? hostRoutes.league(league.handle)
            : addressOf(tournament),
        ),
      ),
    ),
    foot: [
      stop(
        'league',
        'League',
        null,
        linkTo('League', hostRoutes.league(league.handle)),
      ),
      stop(
        'people',
        'People',
        null,
        linkTo('People', hostRoutes.leaguePeople(league.handle)),
      ),
    ],
  };
}

/** What a sanction request says about the check against the template. */
const meetsWords = (sanction: Sanction): string =>
  sanction.follows
    ? `Follows your ${sanction.template.name} template, so it already meets everything the template enforces.`
    : sanction.mismatches.length === 0
      ? `Meets everything your ${sanction.template.name} template enforces.`
      : `Differs from your ${sanction.template.name} template on ${sanction.mismatches.length} enforced ${sanction.mismatches.length === 1 ? 'setting' : 'settings'}.`;

/** A template's own row as one line, under the template's name. */
const templateLine = (
  template: TemplateView,
  row: TemplateSettingRow | null,
  copy: SettingLineCopy,
  hold = row?.hold ?? 'default',
): SettingLine => ({
  keys: copy.keys,
  label: copy.label,
  value: copy.value,
  source: { scope: 'template', name: `the ${template.name} template` },
  control: openSetting(copy.edit ?? null, hold),
  attention: null,
});

/** The words a host league page uses for its template and lobby lines. */
export type HostLeagueCopy = {
  readonly template: {
    /** Each row line's words; the pins are worded by their own names. */
    readonly rows: readonly (SettingLineCopy & {
      readonly keys: readonly [SettingKey, ...SettingKey[]];
    })[];
    readonly note: string;
  };
  readonly lobby: readonly (SettingLineCopy & {
    readonly keys: readonly [SettingKey, ...SettingKey[]];
  })[];
};

/**
 * The host page of a league: the organization's host read, its template,
 * its season, its sanction requests, and its standing lobby's settings.
 */
export function hostLeagueOf(
  reads: {
    readonly league: Extract<OrganizationView, { audience: 'host' }>;
    readonly template: TemplateView;
    readonly season: SeasonView;
    readonly sanctions: SanctionList;
    readonly lobbySettings: ResolvedSettingsView;
  },
  copy: HostLeagueCopy,
): HostLeague {
  const { league, template, season, sanctions, lobbySettings } = reads;
  const standings = season.standings;
  const awaiting = standings.awaitingCertification.map((lobby) => lobby.name);
  const change = sampleAction('Change');
  return {
    name: league.name,
    lede: `${league.schoolCount} schools · ${league.memberCount} members · ${league.openRoomCount} rooms open in the lobby right now`,
    lobbyView: linkTo(
      'View the lobby as a member',
      tabRoutes.league(league.handle),
    ),
    requests: sanctions.sanctions
      .filter((sanction) => sanction.status === 'requested')
      .map((sanction) => ({
        event: sanction.lobby.name,
        facts: `${sanction.event.name} · ${dayWords(sanction.lobby.startsAt)} · hosted by ${sanction.host.name}`,
        meets: meetsWords(sanction),
        decline: sampleAction('Decline'),
        sanction: sampleAction('Sanction it', true),
      })),
    template: {
      name: `${template.name} template`,
      settings: [
        templateLine(
          template,
          null,
          { keys: ['format'], label: 'Format', value: template.format.name },
          'enforced',
        ),
        templateLine(
          template,
          null,
          {
            keys: ['ballot.definition'],
            label: 'Ballot',
            value: template.ballotDefinition?.name ?? 'The Daisy ballot',
          },
          'enforced',
        ),
        ...copy.template.rows.map((line) =>
          templateLine(
            template,
            template.settings.find((row) => row.key === line.keys[0]) ?? null,
            line,
          ),
        ),
      ],
      edit: sampleAction('Edit template'),
      note: copy.template.note,
    },
    season: {
      heading: `Season standings · ${standings.series.name}`,
      rows: standings.rows.map((row) => ({
        place: row.place,
        name: row.entrant,
        school: row.school,
        points: row.points,
        you: row.viewer,
      })),
      note: [
        `From ${standings.certifiedCount} certified ${standings.certifiedCount === 1 ? 'tournament' : 'tournaments'}.`,
        awaiting.length === 0
          ? null
          : `${awaiting.join(' and ')} ${awaiting.length === 1 ? 'is' : 'are'} added when it's certified.`,
      ]
        .filter((part): part is string => part !== null)
        .join(' '),
      rule: sampleAction('How points are counted'),
    },
    ladder: {
      detail: `Rates lobby rooms and tournaments run here. ${league.ratedCount} members rated. Separate from Daisy's ladders.`,
      open: linkTo(
        'Open the ladder',
        tabRoutes.league(league.handle, 'ladder'),
      ),
    },
    lobby: copy.lobby.flatMap((line) => {
      const entry = resolvedEntry(lobbySettings, line.keys[0]);
      return entry === null
        ? []
        : [settingLineOf(entry, { edit: change, ...line })];
    }),
  };
}

export const readLeagueRail = (
  slug: string,
  scene: SampleScene,
): TimelineRail | null =>
  slug === sampleLeagueView.handle
    ? leagueRailOf(
        sampleSeasonView(scene),
        sampleLeagueView,
        sampleNow,
        sampleHostAddress,
      )
    : null;

export const readHostLeague = (
  slug: string,
  scene: SampleScene,
): HostLeague | null =>
  slug === sampleLeagueView.handle
    ? hostLeagueOf(
        {
          league: sampleLeagueView,
          template: sampleVarsityTemplate,
          season: sampleSeasonView(scene),
          sanctions: sampleSanctionList,
          lobbySettings: sampleLeagueLobbySettings(),
        },
        sampleHostLeagueCopy,
      )
    : null;

/** What a league lobby page is projected from: the lobby, and its open tab's read. */
export type LeagueLobbyReads = {
  readonly lobby: StandingLobbyView;
  readonly panel:
    | { readonly tab: 'rooms'; readonly rooms: LobbyRoomList }
    | {
        readonly tab: 'ladder';
        readonly ladder: LobbyLadder;
        readonly scope: LadderScope;
        readonly search: string;
      }
    | { readonly tab: 'tournaments'; readonly tournaments: LobbyListPage }
    // The season tab is still drawn as the sample's screen.
    | { readonly tab: 'season'; readonly season: LeaguePanel };
};

const leagueTabs: readonly (readonly [LeagueTab, string])[] = [
  ['rooms', 'Rooms'],
  ['ladder', 'Ladder'],
  ['season', 'Season'],
  ['tournaments', 'Tournaments'],
];

function roomsPanel(
  lobby: StandingLobbyView,
  list: LobbyRoomList,
  addressOf: AddressOf,
): LeaguePanel {
  const pool = lobby.resolutionPool;
  const open = list.rooms.flatMap((room) =>
    room.status === 'open' ? [room] : [],
  );
  const live = list.rooms.flatMap((room) =>
    room.status === 'live' ? [room] : [],
  );
  const href = (roomId: string) => addressOf({ kind: 'room', roomId });
  const needs = (room: (typeof open)[number]) => {
    const wanted = [
      room.open.debaters > 0 ? 'an opponent' : null,
      room.open.judges > 0 ? 'a judge' : null,
    ].filter((one) => one !== null);
    return wanted.length === 0 ? null : `needs ${listed(wanted)}`;
  };
  return {
    kind: 'rooms',
    pool:
      pool === null
        ? { title: 'No pool this month', detail: '' }
        : {
            title: `${pool.name}'s pool:`,
            detail: `${pool.resolutions} resolutions on ${pool.theme}. Every room strikes from ${numberWord(pool.perRoom)} of them.`,
          },
    groups: [
      {
        heading: 'Open',
        rooms: open.map((room) => ({
          title: room.name,
          detail: [
            room.school,
            room.host.rating === null ? null : String(room.host.rating),
            needs(room),
            // A Room whose debaters are all seated is waiting to start.
            room.open.debaters === 0
              ? `waiting ${Math.round((Date.parse(list.asOf) - Date.parse(room.openedAt)) / 60_000)} min`
              : null,
          ]
            .filter((one) => one !== null)
            .join(' · '),
          action:
            room.open.debaters > 0 && room.capabilities.join
              ? actionTo('Join', href(room.roomId), true)
              : actionTo('Judge', href(room.roomId), true),
        })),
      },
      {
        heading: 'Live now',
        rooms: live.map((room) => ({
          title: room.debaters.join(' v '),
          detail: `${room.segment} · judged by ${listed(room.judges)}`,
          action: actionTo('Watch', href(room.roomId)),
        })),
      },
    ],
    note: "Rooms here use the league's format and count for the league ladder. Only members can see them.",
  };
}

function ladderPanel(
  lobby: StandingLobbyView,
  ladder: LobbyLadder,
  view: { readonly scope: LadderScope; readonly search: string },
): LeaguePanel {
  const viewer = ladder.viewer;
  const row = (line: LobbyLadder['lines'][number]): LadderRow => {
    const you = line.actorId === viewer?.actorId;
    const name = you ? 'You' : line.username;
    return {
      place: line.place,
      name,
      school: line.school ?? '',
      record: `${line.wins}–${line.losses}`,
      rating: line.rating,
      change: line.change,
      you,
      profile: sampleAction(name),
    };
  };
  const searching = view.search !== '';
  const top = view.scope === 'top' && !searching;
  return {
    kind: 'ladder',
    address: tabRoutes.league(lobby.handle),
    scope: view.scope,
    search: view.search,
    // Your own line leads the top of the ladder, wherever you stand on it.
    rows: [...(top && viewer !== null ? [viewer] : []), ...ladder.lines].map(
      row,
    ),
    count: searching
      ? `${ladder.lines.length} of ${ladder.entrants} debaters`
      : ladder.pages > 1
        ? `${ladder.entrants} debaters · Page ${ladder.page} of ${ladder.pages}`
        : `${ladder.entrants} debaters`,
    next: top && ladder.page < ladder.pages ? sampleAction('Next') : null,
    note: "Rates this lobby's rooms and the league's tournaments. Separate from Daisy's ladders.",
    rules: sampleAction('How ratings work'),
  };
}

function tournamentsPanel(
  lobby: StandingLobbyView,
  page: LobbyListPage,
  addressOf: AddressOf,
): LeaguePanel {
  const tournaments = page.lobbies.flatMap((one) =>
    one.kind === 'tournament' ? [one] : [],
  );
  const row = (one: (typeof tournaments)[number]) => {
    const fact = listedFact(one, page.asOf);
    const entered = one.part?.kind === 'competitor';
    const href = addressOf({ kind: 'tournament', handle: one.handle });
    const detail =
      one.status === 'completed'
        ? [dayMonthOf(one.startsAt), 'certified', fact]
        : one.status === 'draft'
          ? [monthOf(one.startsAt), 'entry not open yet']
          : one.concurrentEvents
            ? [
                shortDateOf(one.startsAt),
                `${one.events.length} events`,
                entered ? 'you are entered' : null,
              ]
            : [
                one.status === 'running' ? null : shortDateOf(one.startsAt),
                entered ? capitalized('you are entered') : null,
                one.hostedBy === null ? null : `hosted by ${one.hostedBy}`,
                one.events[0] ?? null,
                fact,
              ];
    return {
      name: one.name,
      detail: detail.filter((part) => part !== null).join(' · '),
      action:
        one.status === 'completed'
          ? actionTo('Results', href)
          : one.status === 'draft' || href === null
            ? actionTo('View', null)
            : actionTo('Open', href),
    };
  };
  const groups = [
    {
      heading: 'Today',
      rows: tournaments.filter((one) => one.status === 'running'),
    },
    {
      heading: 'Coming up',
      rows: tournaments.filter(
        (one) => one.status === 'open' || one.status === 'draft',
      ),
    },
    {
      heading: 'Finished',
      rows: tournaments.filter((one) => one.status === 'completed'),
    },
  ];
  return {
    kind: 'tournaments',
    groups: groups
      .filter((group) => group.rows.length > 0)
      .map((group) => ({
        heading: group.heading,
        rows: group.rows.map(row),
        more: null,
      })),
    note: `All ${numberWord(tournaments.length)} count toward the ${lobby.season ?? ''} season once their results are certified.`,
  };
}

/** A league's standing lobby, as one of its members sees it. */
export function leagueLobbyOf(
  reads: LeagueLobbyReads,
  addressOf: AddressOf,
): LeagueLobby {
  const { lobby, panel } = reads;
  const ladder = lobby.ladder;
  return {
    name: lobby.name,
    lede:
      ladder === null
        ? 'Not on the league ladder yet'
        : `League rating ${ladder.rating} · ${ordinalOf(ladder.place)} of ${ladder.of}`,
    create: lobby.capabilities.createRoom
      ? linkTo('New room', tabRoutes.newLeagueRoom(lobby.handle), true)
      : null,
    tabs: leagueTabs.map(([id, label]) => ({
      id,
      label,
      href: tabRoutes.league(lobby.handle, id),
      selected: id === panel.tab,
    })),
    panel: panelOf(reads, addressOf),
  };
}

function panelOf(
  { lobby, panel }: LeagueLobbyReads,
  addressOf: AddressOf,
): LeaguePanel {
  switch (panel.tab) {
    case 'rooms':
      return roomsPanel(lobby, panel.rooms, addressOf);
    case 'ladder':
      return ladderPanel(lobby, panel.ladder, panel);
    case 'tournaments':
      return tournamentsPanel(lobby, panel.tournaments, addressOf);
    case 'season':
      return panel.season;
  }
}

export function readLeagueLobby(
  slug: string,
  view: LeagueView,
  scene: SampleScene,
): LeagueLobby | null {
  const lobby = sampleStandingLobby(scene);
  if (slug !== lobby.handle) return null;
  const panel = ((): LeagueLobbyReads['panel'] | null => {
    switch (view.tab) {
      case 'rooms':
        return { tab: 'rooms', rooms: sampleLobbyRooms(scene) };
      case 'ladder':
        return {
          tab: 'ladder',
          ladder: sampleLadder(view.scope, view.search),
          scope: view.scope,
          search: view.search,
        };
      case 'tournaments':
        return {
          tab: 'tournaments',
          tournaments: sampleLeagueTournaments(scene),
        };
      case 'season': {
        const season = sampleSeasonPanel(view.event);
        return season === null ? null : { tab: 'season', season };
      }
    }
  })();
  return panel === null
    ? null
    : leagueLobbyOf({ lobby, panel }, sampleAddressOf);
}

/** The view an address asks for; anything unknown reads as the Rooms tab. */
export function leagueViewOf(query: {
  readonly tab: string | null;
  readonly scope: string | null;
  readonly search: string | null;
  readonly event: string | null;
}): LeagueView {
  switch (query.tab) {
    case 'ladder':
      return {
        tab: 'ladder',
        scope: query.scope === 'around' ? 'around' : 'top',
        search: (query.search ?? '').trim().slice(0, 40),
      };
    case 'season':
      return { tab: 'season', event: query.event };
    case 'tournaments':
      return { tab: 'tournaments' };
    case 'rooms':
    case null:
    default:
      return { tab: 'rooms' };
  }
}

/** The words the create-room form uses for the template it offers first. */
export type CreateRoomCopy = {
  /** The name the form proposes for the Room. */
  readonly name: string;
  /** The locked lines: the template's pins (`format`, `ballot.definition`), then setting keys. */
  readonly locked: readonly (SettingLineCopy & {
    readonly keys: readonly [string, ...string[]];
  })[];
  readonly defaults: readonly Choice[];
  /** The ladder a ranked Room counts for, by name. */
  readonly ladder: string;
};

/** What the form is drawn from: the lobby, the Room draft's view, the offered templates. */
export type CreateRoomReads = {
  readonly lobby: { readonly name: string; readonly handle: string };
  readonly draft: ResolvedSettingsView;
  /**
   * The lobby's own view, for the ladder its Rooms count for: a key the
   * catalogue reads only on an event's chain, so a draft does not carry it.
   */
  readonly lobbySettings: ResolvedSettingsView;
  readonly templates: readonly TemplateView[];
};

const pins = new Set(['format', 'ballot.definition']);
const isSettingKey = (
  view: ResolvedSettingsView,
  key: string,
): key is SettingKey => view.settings.some((entry) => entry.key === key);

/**
 * The create-room form from the resolved-settings view of the Room being
 * drafted and the templates the lobby offers: the template's pins and every
 * value a scope enforces shown locked, the rest left to the form. A key the
 * Room's chain does not read (recording) is shown from the template's own
 * enforced row.
 */
export function createRoomOf(
  reads: CreateRoomReads,
  copy: CreateRoomCopy,
): CreateRoom | null {
  const { draft } = reads;
  if (draft.at.kind !== 'room_draft') return null;
  const templateId = draft.at.templateId;
  const template = reads.templates.find(
    (offered) => offered.templateId === templateId,
  );
  if (template === undefined) return null;
  const owner = {
    scope: 'organization',
    name: template.organization.name,
  } as const;
  const lockedLine = (line: CreateRoomCopy['locked'][number]): SettingLine => ({
    keys: line.keys,
    label: line.label,
    value: line.value,
    source: owner,
    control: lockedSetting,
    attention: null,
  });
  const locked = copy.locked.flatMap((line): readonly SettingLine[] => {
    const [key] = line.keys;
    if (pins.has(key)) return [lockedLine(line)];
    if (isSettingKey(draft, key)) {
      const entry = resolvedEntry(draft, key);
      return entry?.locked === 'enforced' ? [settingLineOf(entry, line)] : [];
    }
    return template.settings.some(
      (row) => row.key === key && row.hold === 'enforced',
    )
      ? [lockedLine(line)]
      : [];
  });
  const ladder = resolvedEntry(reads.lobbySettings, 'standings.rating_ladder')
    ?.value as { readonly ladderId: string | null } | undefined;
  return {
    lobby: {
      name: reads.lobby.name,
      href: tabRoutes.league(reads.lobby.handle),
    },
    name: copy.name,
    templates: reads.templates.map((offered) => ({
      name: offered.name,
      detail: offered.format.name,
    })),
    template: template.name,
    lockedBy: template.organization.name,
    locked,
    defaults: copy.defaults,
    ranked: {
      label: 'Ranked',
      detail: `${copy.ladder} ladder`,
      checked: (ladder?.ladderId ?? null) !== null,
    },
    open: sampleAction('Create room', true),
  };
}

export const readCreateRoom = (
  slug: string,
  scene: SampleScene,
): CreateRoom | null => {
  const sample = sampleCreateRoom(slug, scene);
  return sample === null ? null : createRoomOf(sample.reads, sample.copy);
};
