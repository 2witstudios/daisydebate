import {
  canWatchLive,
  seatAllowed,
  sideSeat,
  type RatingDivision,
  type RoomListEntry,
  type RoundStage,
} from '@daisy/protocol';
import { drawnTopicLabel } from '../debate-room/vocabulary';
import { liveHref, watchRoutes } from '../watch/routes';

type RowState = 'open' | 'starting' | 'live';

/**
 * One verb per meaning, so a row's button always says the same thing: Watch
 * looks on, Join takes a seat, Judge takes a judge seat in the other lobby's
 * Room, Return to room goes back to a seat the viewer holds.
 */
export type LobbyAction = {
  readonly verb: 'Watch' | 'Join' | 'Judge' | 'Return to room';
  readonly href: string;
  readonly primary: boolean;
};

/** Who reads the Lobby: their actor and their own division (none without an age record). */
export type LobbyViewer = {
  readonly actorId: string | null;
  readonly division: RatingDivision | null;
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
  /** Watch first, then the row's seat action; none for a Round the viewer may not watch. */
  readonly actions: readonly LobbyAction[];
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

/**
 * Where someone without a seat watches a live Round: its public page. Only a
 * seatless host lists a Round that is not public, and that page admits them by
 * its link alone, so they keep the Round's own guarded page.
 */
const watchHrefOf = (entry: RoomListEntry): string => {
  const round = entry.roundRef;
  if (!round) return watchRoutes.hub;
  return entry.visibility === 'public'
    ? liveHref(round.id)
    : `/rounds/${round.id}`;
};

const action = (
  verb: LobbyAction['verb'],
  href: string,
  primary: boolean,
): LobbyAction => ({ verb, href, primary });

/**
 * A row's actions for this viewer (ADR 0155). A seat they hold is Return to
 * room. Otherwise Watch sits beside the seat action: Join in a Room of their
 * own lobby, Judge in the other lobby's Room while a judge seat is free, none
 * when neither fits. A Room before its Round is watched on its own page; a
 * live Round on its watch page, and a live Youth Round only by its audience.
 */
export function rowActions(
  viewer: LobbyViewer,
  room: RoomListEntry,
  state: RowState,
): readonly LobbyAction[] {
  const roomHref = `/rooms/${room.id}`;
  const round = room.roundRef;
  if (room.seated)
    return [
      action(
        'Return to room',
        state === 'live' && round ? `/rounds/${round.id}/room` : roomHref,
        true,
      ),
    ];
  if (state === 'live') {
    const standing =
      viewer.actorId !== null && viewer.actorId === room.hostActorId
        ? 'seatless-host'
        : 'none';
    return canWatchLive({ standing }, room)
      ? [action('Watch', watchHrefOf(room), false)]
      : [];
  }
  const watch = action('Watch', roomHref, false);
  if (state === 'starting') return [watch];
  const debates = seatAllowed(
    { kind: 'human', division: viewer.division },
    room,
    sideSeat('affirmative'),
  );
  if (debates) return [watch, action('Join', roomHref, true)];
  return room.openJudgeSeats > 0
    ? [watch, action('Judge', roomHref, false)]
    : [watch];
}

const stageLabels: Readonly<Record<RoundStage, string>> = {
  countdown: 'Starting',
  prep: 'Prep',
  live: 'Speeches',
  awaiting_ballot: 'Judging',
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

/** A listed Room as one compact Lobby row, read at `now` (epoch ms) by `viewer`. */
export function lobbyRow(
  now: number,
  entry: RoomListEntry,
  viewer: LobbyViewer,
): LobbyRow {
  const state = states[entry.status];
  return {
    id: entry.id,
    title: entry.title,
    topic: entry.topic ?? `Resolution: ${drawnTopicLabel.toLocaleLowerCase()}`,
    host: entry.hostLabel,
    mode: entry.competitionType === 'ranked' ? 'Ranked' : 'Casual',
    format: entry.formatLabel,
    facts: factsFor(now, entry, state),
    state,
    status: statusLabels[state],
    actions: rowActions(viewer, entry, state),
  };
}

/**
 * The listing's page grouped open, starting, then live, each group in
 * listing order. The listing has already narrowed it to one lobby; empty
 * groups are left out.
 */
export function lobbySections(
  now: number,
  rooms: readonly RoomListEntry[],
  viewer: LobbyViewer,
): readonly LobbySection[] {
  const rows = rooms.map((entry) => lobbyRow(now, entry, viewer));
  return (['open', 'starting', 'live'] as const)
    .map((id) => ({
      id,
      label: sectionLabels[id],
      rows: rows.filter((row) => row.state === id),
    }))
    .filter((section) => section.rows.length > 0);
}
