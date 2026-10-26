import type { RoomListEntry } from '@daisy/protocol';
import type { LobbyFilters } from './discovery-query';

type RowState = 'open' | 'starting' | 'live';

/** One verb per Room state, so a row's button always means the same thing. */
export type LobbyAction = {
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

/** A listed Room as one compact Lobby row. */
export function lobbyRow(entry: RoomListEntry): LobbyRow {
  const state = states[entry.status];
  return {
    id: entry.id,
    title: entry.title,
    topic: entry.topic,
    host: entry.hostLabel,
    mode: entry.competitionType === 'ranked' ? 'Ranked' : 'Casual',
    state,
    status: statusLabels[state],
    action: actionFor(entry, state),
  };
}

const matches = (entry: RoomListEntry, filters: LobbyFilters): boolean =>
  (filters.status === 'all' || states[entry.status] === filters.status) &&
  (filters.mode === 'any' || entry.competitionType === filters.mode);

/**
 * The page's Rooms narrowed by the filters and grouped open, starting, then
 * live, each group in listing order. Empty groups are left out.
 */
export function lobbySections(
  rooms: readonly RoomListEntry[],
  filters: LobbyFilters,
): readonly LobbySection[] {
  const rows = rooms.filter((entry) => matches(entry, filters)).map(lobbyRow);
  return (['open', 'starting', 'live'] as const)
    .map((id) => ({
      id,
      label: sectionLabels[id],
      rows: rows.filter((row) => row.state === id),
    }))
    .filter((section) => section.rows.length > 0);
}
