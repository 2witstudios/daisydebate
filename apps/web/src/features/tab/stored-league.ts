import { settingValueSchemas } from '@daisy/protocol/setting-values';
import { lockedSetting, openSetting, type SettingLine } from './settings';
import type { LobbyLadder } from '@daisy/protocol/lobby/lobby-read';
import type {
  LeagueLobby,
  LeaguePanel,
  LeagueView,
  HostLeague,
} from './league';
import type {
  LeagueSeasonProjection,
  LeagueSeasonRead,
} from './reads/league-season';
import type { TimelineRail } from './tournament';
import { linkTo } from './action';
import { tabRoutes, hostRoutes } from './routes';

const seasonRows = (read: LeagueSeasonProjection) =>
  read.view.standings.rows.map((row) => ({
    place: row.place,
    name: row.entrant,
    school: row.school,
    points: row.points,
    you: row.viewer,
  }));
const seasonNote = (read: LeagueSeasonProjection) =>
  [
    `${read.view.standings.certifiedCount} certified tournaments`,
    read.view.standings.awaitingCertification.length
      ? `${read.view.standings.awaitingCertification.map((row) => row.name).join(', ')} awaiting certification`
      : null,
    read.formula?.bestEvents
      ? `Best ${read.formula.bestEvents} events count`
      : null,
    read.formula?.topPerSchool
      ? `Top ${read.formula.topPerSchool} competitors per school count`
      : null,
    read.formula?.preliminaryWin.cap !== null &&
    read.formula?.preliminaryWin.cap !== undefined
      ? `Preliminary win points capped at ${read.formula.preliminaryWin.cap}`
      : null,
    read.formula ? null : 'Points rule is unconfigured',
  ]
    .filter(Boolean)
    .join(' · ');
function seasonPanel(
  handle: string,
  read: LeagueSeasonProjection,
): LeaguePanel {
  return {
    kind: 'season',
    seasonId: read.view.seasonId,
    address: tabRoutes.league(handle),
    season: read.view.name,
    events: read.series.map((row) => ({ slug: row.id, name: row.name })),
    event: read.view.standings.series.templateId,
    rows: seasonRows(read),
    all: null,
    points: read.formula
      ? [
          {
            label: 'Preliminary win',
            points: read.formula.preliminaryWin.points,
          },
          {
            label: 'Elimination round',
            points: read.formula.eliminationRound.points,
          },
        ]
      : [],
    note: seasonNote(read),
    tournaments: linkTo(
      'Season tournaments',
      tabRoutes.league(handle, 'tournaments'),
    ),
  };
}
function ladderPanel(
  handle: string,
  ladder: LobbyLadder,
  view: Extract<LeagueView, { tab: 'ladder' }>,
): LeaguePanel {
  const pinned = view.scope === 'top' && !view.search ? ladder.viewer : null;
  const lines = pinned
    ? [pinned, ...ladder.lines.filter((row) => row.actorId !== pinned.actorId)]
    : ladder.lines;
  const query = new URLSearchParams({
    tab: 'ladder',
    scope: view.scope,
    q: view.search,
    page: String(ladder.page + 1),
  });
  return {
    kind: 'ladder',
    address: tabRoutes.league(handle),
    scope: view.scope,
    search: view.search,
    rows: lines.map((row) => ({
      place: row.place,
      name: row.actorId === ladder.viewer?.actorId ? 'You' : row.username,
      school: row.school ?? '',
      record: `${row.wins}–${row.losses}`,
      rating: row.rating,
      change: row.change,
      you: row.actorId === ladder.viewer?.actorId,
      profile: linkTo(
        row.username,
        `/profile/${encodeURIComponent(row.username)}`,
      ),
    })),
    count: `${ladder.entrants} debaters · Page ${ladder.page} of ${ladder.pages}`,
    next:
      ladder.page < ladder.pages && view.scope === 'top'
        ? linkTo('Next', `${tabRoutes.league(handle)}?${query}`)
        : null,
    note: 'League ratings include eligible lobby Rooms and certified tournaments.',
    rules: linkTo('Season standings', tabRoutes.league(handle, 'season')),
  };
}
/** Live pages receive only stored readers; sample projections never enter this path. */
export function storedLeagueLobbyOf(
  handle: string,
  read: LeagueSeasonProjection,
  view: LeagueView,
  ladder: LobbyLadder | null,
): LeagueLobby {
  const tab =
    view.tab === 'ladder'
      ? 'ladder'
      : view.tab === 'tournaments'
        ? 'tournaments'
        : 'season';
  return {
    name: read.view.organization.name,
    lede: read.view.name,
    create: null,
    tabs: [
      ['season', 'Season'],
      ['ladder', 'Ladder'],
      ['tournaments', 'Tournaments'],
    ].map(([id, label]) => ({
      id: id as 'season' | 'ladder' | 'tournaments',
      label: label!,
      href: tabRoutes.league(handle, id as 'season' | 'ladder' | 'tournaments'),
      selected: id === tab,
    })),
    panel:
      view.tab === 'ladder' && ladder
        ? ladderPanel(handle, ladder, view)
        : view.tab === 'tournaments'
          ? calendarPanel(read)
          : seasonPanel(handle, read),
  };
}
export function storedHostLeagueOf(
  handle: string,
  read: LeagueSeasonRead,
): HostLeague {
  return {
    name: read.view.organization.name,
    lede: read.view.name,
    lobbyView: linkTo('View as a member', tabRoutes.league(handle, 'season')),
    requests: read.requests.map((row) => ({
      id: row.sanctionId,
      event: row.lobbyName,
      facts: `${row.eventName} · ${row.templateName}`,
      meets: 'Approval checks the current template requirements.',
      decline: linkTo('Decline', hostRoutes.league(handle)),
      sanction: linkTo('Sanction it', hostRoutes.league(handle), true),
    })),
    template: {
      name: `${read.template.name} template`,
      settings: [
        {
          keys: ['format'],
          label: 'Format',
          value: `${read.template.formatId.charAt(0).toUpperCase() + read.template.formatId.slice(1)} · version ${read.template.formatVersion}`,
          source: { scope: 'template', name: read.template.name },
          control: lockedSetting,
          attention: null,
        },
        {
          keys: ['ballot.definition'],
          label: 'Ballot',
          value: read.template.ballotDefinitionId
            ? 'Custom ballot'
            : 'Daisy ballot',
          source: { scope: 'template', name: read.template.name },
          control: lockedSetting,
          attention: null,
        },
        ...read.template.settings.flatMap((row) =>
          templateLine(row, read.template.name),
        ),
      ],
      edit: null,
      note: '',
    },
    season: {
      heading: `Season standings · ${read.view.standings.series.name}`,
      rows: seasonRows(read),
      note: seasonNote(read),
      rule: linkTo('How points count', tabRoutes.league(handle, 'season')),
    },
    ladder: {
      detail:
        'League ratings include eligible lobby Rooms and certified tournaments.',
      open: linkTo('Open the ladder', tabRoutes.league(handle, 'ladder')),
    },
    lobby: [],
  };
}
export const storedLeagueRail = (
  handle: string,
  read: LeagueSeasonProjection,
): TimelineRail => ({
  title: read.view.organization.name,
  subtitle: read.view.name,
  heading: null,
  footHeading: null,
  items: [
    {
      id: 'league',
      label: 'League',
      time: null,
      standing: null,
      action: linkTo('League', hostRoutes.league(handle)),
    },
  ],
  foot: [],
});

function templateLine(
  row: LeagueSeasonRead['template']['settings'][number],
  name: string,
): readonly SettingLine[] {
  const choice =
    row.key === 'recording.capture'
      ? { label: 'Recording', schema: settingValueSchemas['recording.capture'] }
      : row.key === 'room.visibility'
        ? {
            label: 'Room visibility',
            schema: settingValueSchemas['room.visibility'],
          }
        : null;
  if (!choice) return [];
  const parsed = choice.schema.safeParse(row.value);
  if (!parsed.success) return [];
  return [
    {
      keys: [row.key],
      label: choice.label,
      value: parsed.data.value,
      source: { scope: 'template', name },
      control: openSetting(null, row.hold),
      attention: null,
    },
  ];
}

function calendarPanel(read: LeagueSeasonProjection): LeaguePanel {
  const calendar = read.view.calendar;
  return {
    kind: 'tournaments',
    groups: [
      {
        heading: 'Today',
        rows: calendar.filter(
          (row) =>
            !row.completed &&
            row.when.precision === 'day' &&
            row.when.startsAt.slice(0, 10) === read.asOf.slice(0, 10),
        ),
      },
      {
        heading: 'Coming up',
        rows: calendar.filter(
          (row) =>
            !row.completed &&
            !(
              row.when.precision === 'day' &&
              row.when.startsAt.slice(0, 10) === read.asOf.slice(0, 10)
            ),
        ),
      },
      { heading: 'Finished', rows: calendar.filter((row) => row.completed) },
    ]
      .filter((group) => group.rows.length)
      .map((group) => ({
        heading: group.heading,
        rows: group.rows.map((row) => ({
          name: row.name,
          detail: [
            row.when.precision === 'day'
              ? row.when.startsAt.slice(0, 10)
              : row.when.month,
            row.sanction ?? 'Membership',
          ].join(' · '),
          action: linkTo(
            row.completed ? 'Results' : 'Open',
            tabRoutes.tournament(row.handle),
          ),
        })),
        more: null,
      })),
    note: read.view.name,
  };
}
