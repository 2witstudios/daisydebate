import type { RoomListEntry, RoundStage } from '@daisy/protocol';

type RowState = 'open' | 'starting' | 'live';

/** One verb per Room state, so a row's button always means the same thing. */
type LobbyAction = {
  readonly verb: 'Join' | 'Spectate' | 'Watch' | 'Return to room';
  readonly href: string;
  readonly primary: boolean;
};

export type LobbyRow = {
  readonly id: string;
  readonly title: string;
  readonly topic: string;
  readonly host: string | null;
  readonly mode: 'Ranked' | 'Casual';
  readonly format: string;
  /** Seats and wait while open, seats while starting, the stage when live. */
  readonly facts: readonly string[];
  readonly state: RowState;
  readonly status: 'Open' | 'Starting' | 'Live';
  readonly action: LobbyAction;
};

export type LobbySection = {
  readonly id: RowState;
  readonly label: string;
  readonly rows: readonly LobbyRow[];
};

const states: Readonly<Record<RoomListEntry['status'], RowState>> = {
  assembling: 'open',
  ready: 'starting',
  started: 'live',
};

const statusLabels = {
  open: 'Open',
  starting: 'Starting',
  live: 'Live',
} as const;

const sectionLabels: Readonly<Record<RowState, string>> = {
  open: 'Open',
  starting: 'Starting',
  live: 'Live now',
};

const actionFor = (entry: RoomListEntry, state: RowState): LobbyAction => {
  const roomHref = `/rooms/${entry.id}`;
  const round = entry.roundRef;
  if (entry.seated)
    return {
      verb: 'Return to room',
      href: state === 'live' && round ? `/rounds/${round.id}/room` : roomHref,
      primary: true,
    };
  if (state === 'open') return { verb: 'Join', href: roomHref, primary: true };
  if (state === 'starting')
    return { verb: 'Spectate', href: roomHref, primary: false };
  return {
    verb: 'Watch',
    href: round ? `/rounds/${round.id}` : roomHref,
    primary: false,
  };
};

const stageLabels: Readonly<Record<RoundStage, string>> = {
  countdown: 'Starting',
  prep: 'Prep',
  live: 'Speeches',
};

const minuteMs = 60_000;

/** How long an open Room has waited for its cast, to the minute or hour. */
const waitedFor = (now: number, since: string): string => {
  const minutes = Math.floor((now - Date.parse(since)) / minuteMs);
  if (minutes < 1) return 'Just opened';
  if (minutes < 60) return `Waiting ${minutes} min`;
  return `Waiting ${Math.floor(minutes / 60)} h`;
};

const factsFor = (
  now: number,
  entry: RoomListEntry,
  state: RowState,
): readonly string[] => {
  if (state === 'live') {
    const stage = entry.live?.stage;
    return stage ? [stageLabels[stage]] : [];
  }
  const seats = `${entry.seatsTaken} of ${entry.seatCount} seats`;
  return state === 'open' && entry.waitingSince
    ? [seats, waitedFor(now, entry.waitingSince)]
    : [seats];
};

/**
 * A listed Room as one compact Lobby row, read at `now` (epoch ms). The host's
 * rating stays out while the beta is unranked.
 */
export function lobbyRow(now: number, entry: RoomListEntry): LobbyRow {
  const state = states[entry.status];
  return {
    id: entry.id,
    title: entry.title,
    topic: entry.topic,
    host: entry.hostLabel,
    mode: entry.competitionType === 'ranked' ? 'Ranked' : 'Casual',
    format: entry.formatLabel,
    facts: factsFor(now, entry, state),
    state,
    status: statusLabels[state],
    action: actionFor(entry, state),
  };
}

/**
 * The listing's page grouped open, starting, then live, each group in
 * listing order. The listing has already narrowed it; empty groups are left
 * out.
 */
export function lobbySections(
  now: number,
  rooms: readonly RoomListEntry[],
): readonly LobbySection[] {
  const rows = rooms.map((entry) => lobbyRow(now, entry));
  return (['open', 'starting', 'live'] as const)
    .map((id) => ({
      id,
      label: sectionLabels[id],
      rows: rows.filter((row) => row.state === id),
    }))
    .filter((section) => section.rows.length > 0);
}
