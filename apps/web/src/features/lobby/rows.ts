import type {
  RatingDivision,
  RoomListEntry,
  RoundStage,
  SeatedDivision,
} from '@daisy/protocol';
import { drawnTopicLabel } from '../debate-room/vocabulary';
import { firstDebaterSetsLadder } from '../play/ladder-division-words';
import { divisionAudiences } from '../ratings/ladder-labels';
import { liveHref, watchRoutes } from '../watch/routes';

type RowState = 'open' | 'starting' | 'live';

/**
 * One verb per Room state, so a row's button always means the same thing.
 * Judge is an open Room whose debater seats are on the viewer's other ladder
 * while a judge seat is free: anyone may judge (ADR 0147).
 */
type LobbyLink = {
  readonly kind: 'link';
  readonly verb: 'Join' | 'Spectate' | 'Watch' | 'Return to room' | 'Judge';
  readonly href: string;
  readonly primary: boolean;
};

/**
 * An open ranked Room whose debater seats are on the viewer's other ladder,
 * with no judge seat free: a disabled button naming who its seats are for.
 */
type LobbyLocked = {
  readonly kind: 'locked';
  readonly label: string;
};

export type LobbyAction = LobbyLink | LobbyLocked;

export type LobbyRow = {
  readonly id: string;
  readonly title: string;
  readonly topic: string;
  readonly host: string | null;
  readonly mode: 'Ranked' | 'Casual';
  /** A ranked Room's ladder as its seats set it; null on a casual Room. */
  readonly ladder: SeatedDivision | null;
  readonly format: string;
  /** Seats and wait while open, seats while starting, the stage when live. */
  readonly facts: readonly string[];
  readonly state: RowState;
  readonly status: 'Open' | 'Starting' | 'Live';
  readonly action: LobbyAction;
  /** The one line under the facts about who sits where; null when none. */
  readonly note: string | null;
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

const link = (
  verb: LobbyLink['verb'],
  href: string,
  primary: boolean,
): LobbyLink => ({ kind: 'link', verb, href, primary });

const stateActionFor = (entry: RoomListEntry, state: RowState): LobbyLink => {
  const roomHref = `/rooms/${entry.id}`;
  const round = entry.roundRef;
  if (entry.seated)
    return link(
      'Return to room',
      state === 'live' && round ? `/rounds/${round.id}/room` : roomHref,
      true,
    );
  if (state === 'open') return link('Join', roomHref, true);
  // A Room that has not started has no Round to watch yet: its Room is the one
  // page that exists, and it leads on to the Round once there is one.
  if (state === 'starting') return link('Spectate', roomHref, false);
  return link('Watch', watchHrefOf(entry), false);
};

/**
 * The ladder an open ranked Room's debater seats are on, when it is not the
 * viewer's own: set by a seated debater, and the viewer has a ladder.
 */
const otherLadderOf = (
  entry: RoomListEntry,
  state: RowState,
  viewer: RatingDivision | null,
): RatingDivision | null => {
  const { ladder } = entry;
  if (state !== 'open' || entry.seated || viewer === null) return null;
  if (ladder !== 'open' && ladder !== 'youth') return null;
  return ladder === viewer ? null : ladder;
};

const otherLadderNotes: Readonly<Record<RatingDivision, string>> = {
  open: 'Debater seats: 18 and over.',
  youth: 'Debater seats: under 18. You can still judge.',
};

/** Under a Room whose debater seats are not the viewer's, with a judge seat free. */
const judgeSeatOpenNote = 'Judge seat open to everyone.';

/**
 * A row's one action and the line about its seats. A debater seat on the
 * viewer's other ladder is never offered: the row offers the free judge seat
 * instead, or names who its debater seats are for. A Room no debater has sat
 * in says the first one sets its ladder.
 */
const seatingFor = (
  entry: RoomListEntry,
  state: RowState,
  viewer: RatingDivision | null,
): Pick<LobbyRow, 'action' | 'note'> => {
  const other = otherLadderOf(entry, state, viewer);
  if (other !== null)
    return entry.openJudgeSeats > 0
      ? {
          action: link('Judge', `/rooms/${entry.id}`, false),
          note: judgeSeatOpenNote,
        }
      : {
          action: { kind: 'locked', label: divisionAudiences[other] },
          note: otherLadderNotes[other],
        };
  return {
    action: stateActionFor(entry, state),
    note:
      state === 'open' && entry.ladder === 'unset'
        ? firstDebaterSetsLadder
        : null,
  };
};

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

/**
 * A listed Room as one compact Lobby row, read at `now` (epoch ms) by a
 * viewer on `viewer`'s ladder (null: none, or a visitor). The host's rating
 * stays out while the beta is unranked.
 */
export function lobbyRow(
  now: number,
  entry: RoomListEntry,
  viewer: RatingDivision | null,
): LobbyRow {
  const state = states[entry.status];
  return {
    id: entry.id,
    title: entry.title,
    topic: entry.topic ?? `Resolution: ${drawnTopicLabel.toLocaleLowerCase()}`,
    host: entry.hostLabel,
    mode: entry.competitionType === 'ranked' ? 'Ranked' : 'Casual',
    ladder: entry.competitionType === 'ranked' ? entry.ladder : null,
    format: entry.formatLabel,
    facts: factsFor(now, entry, state),
    state,
    status: statusLabels[state],
    ...seatingFor(entry, state, viewer),
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
  viewer: RatingDivision | null,
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
