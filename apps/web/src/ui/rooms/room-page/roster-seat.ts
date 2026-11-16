import {
  isNamedSeat,
  isOpenRoomStatus,
  sideOfTeam,
  teamOfPlacement,
  type DebateSide,
  type RoomTeam,
  type RoomView,
} from '@daisy/protocol';

/**
 * What one roster row shows and may change (ADR 0143), derived from the
 * Room view alone so the page and its tests read the same rules. A debater's
 * seat is their team's placement until Start round; `?` means open, decided
 * by the draw at Start round.
 */
export type SideMark = 'affirmative' | 'negative' | '?';
export type RosterBoxes = {
  /** Shown only when a team seats more than one debater. */
  readonly team: RoomTeam | '?';
  readonly side: SideMark;
  readonly position: number | '?';
  readonly mayMove: boolean;
  readonly maySetSide: boolean;
  /** The next value each box cycles to when clicked: team 1 → 2 → ? → 1. */
  readonly next: {
    readonly team: RoomTeam | null;
    /** Team 1's side to post when this row's side box is clicked. */
    readonly teamOneSide: DebateSide | null;
    readonly position: number | null;
  };
};

type Participant = RoomView['participants'][number];
type Named = Extract<Participant, { actorId: string }>;

/** Whether the roster shows Team and Position: a team seats more than one. */
export const showsTeams = (seats: RoomView['definition']['seats']) =>
  seats.affirmative > 1 || seats.negative > 1;

const sideCycle: readonly SideMark[] = ['?', 'affirmative', 'negative'];
const opposite = (side: DebateSide): DebateSide =>
  side === 'affirmative' ? 'negative' : 'affirmative';

/** The side a team argues as the view stands: `?` while it is open. */
const sideMarkOf = (
  view: Pick<RoomView, 'teamOneSide'>,
  team: RoomTeam,
): SideMark =>
  view.teamOneSide === null ? '?' : sideOfTeam(team, view.teamOneSide);

/** The boxes of one debater's row, or null for a judge or an unnamed seat. */
export function rosterBoxes(
  view: Pick<
    RoomView,
    | 'teamOneSide'
    | 'competitionType'
    | 'hostActorId'
    | 'status'
    | 'definition'
  >,
  participant: Participant,
  viewerActorId: string,
): RosterBoxes | null {
  if (!isNamedSeat(participant) || participant.role === 'judge') return null;
  const seat = participant as Named & { readonly role: DebateSide };
  const team = teamOfPlacement(seat.role);
  const open = isOpenRoomStatus(view.status);
  const mayMove =
    open &&
    (seat.actorId === viewerActorId || view.hostActorId === viewerActorId);
  const { affirmative, negative } = view.definition.seats;
  const side: SideMark = seat.teamOpen ? '?' : sideMarkOf(view, team);
  const maySetSide =
    mayMove &&
    !seat.teamOpen &&
    view.competitionType !== 'ranked' &&
    affirmative === negative;
  const nextSide = sideCycle[(sideCycle.indexOf(side) + 1) % 3]!;
  const teamSize = team === 1 ? affirmative : negative;
  const position = seat.positionOpen ? '?' : seat.slot;
  const nextPosition =
    position === '?' ? 0 : position + 1 < teamSize ? position + 1 : null;
  return {
    team: seat.teamOpen ? '?' : team,
    side,
    position,
    mayMove,
    maySetSide,
    next: {
      team: seat.teamOpen ? 1 : team === 1 ? 2 : null,
      teamOneSide:
        nextSide === '?'
          ? null
          : team === 1
            ? nextSide
            : opposite(nextSide),
      position: nextPosition,
    },
  };
}

export const sideLabels: Readonly<Record<SideMark, string>> = {
  affirmative: 'Aff',
  negative: 'Neg',
  '?': '?',
};

/** "1st", "2nd", "3rd", "4th": a speaking position as a debater reads it. */
export const ordinalOf = (position: number) => {
  const n = position + 1;
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ??
        'th';
  return `${n}${suffix}`;
};
