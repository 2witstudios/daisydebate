import {
  affirmativeSide,
  negativeSide,
  type TwoSideKey,
} from '@daisy/protocol/seats';
import { isNamedSeat } from '@daisy/protocol/round-view';
import { isOpenRoomStatus, type RoomView } from '@daisy/protocol/room-contract';
import {
  seatsTwoTeams,
  sideOfTeam,
  sidesSwappable,
  teamOfPlacement,
  type RoomTeam,
} from '@daisy/protocol/seat-draw';
import { type FormatSeating } from '@daisy/protocol/format-seating';

/**
 * What one roster row shows and may change (ADR 0145), derived from the
 * Room view alone so the page and its tests read the same rules. A debater's
 * seat is their team's placement until Start round; `?` means open, decided
 * by the draw at Start round.
 */
export type SideMark = TwoSideKey | '?';
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
    readonly teamOneSide: TwoSideKey | null;
    readonly position: number | null;
  };
};

type Participant = RoomView['participants'][number];

/** Whether the roster shows Team and Position: a team seats more than one. */
export const showsTeams = (seating: FormatSeating) =>
  seatsTwoTeams(seating) &&
  ((seating.seats.sides[affirmativeSide] ?? 0) > 1 ||
    (seating.seats.sides[negativeSide] ?? 0) > 1);

const sideCycle: readonly SideMark[] = ['?', affirmativeSide, negativeSide];
const opposite = (side: TwoSideKey): TwoSideKey =>
  side === affirmativeSide ? negativeSide : affirmativeSide;

/** The side a team argues as the view stands: `?` while it is open. */
const sideMarkOf = (
  view: Pick<RoomView, 'teamOneSide'>,
  team: RoomTeam,
): SideMark =>
  view.teamOneSide === null ? '?' : sideOfTeam(team, view.teamOneSide);

/**
 * An event Room (no host person; a Tab draw seated it) takes its teams,
 * sides and positions from the draw, never from the roster: nobody's row
 * opens there. The organiser changes a fixture from the host round page.
 */
export const isEventRoom = (view: Pick<RoomView, 'hostActorId'>) =>
  view.hostActorId === null;

/** The boxes of one debater's row, or null for a judge, an unnamed seat or a Room with no two teams. */
export function rosterBoxes(
  view: Pick<
    RoomView,
    'teamOneSide' | 'competitionType' | 'hostActorId' | 'status' | 'definition'
  >,
  participant: Participant,
  viewerActorId: string,
): RosterBoxes | null {
  if (
    !isNamedSeat(participant) ||
    participant.seat.kind !== 'side' ||
    !seatsTwoTeams(view.definition)
  )
    return null;
  const placement = participant.seat.side as TwoSideKey;
  const team = teamOfPlacement(placement);
  const open = isOpenRoomStatus(view.status);
  const mayMove =
    open &&
    !isEventRoom(view) &&
    (participant.actorId === viewerActorId ||
      view.hostActorId === viewerActorId);
  const side: SideMark = participant.teamOpen ? '?' : sideMarkOf(view, team);
  const maySetSide =
    mayMove &&
    !participant.teamOpen &&
    view.competitionType !== 'ranked' &&
    sidesSwappable(view.definition);
  const nextSide = sideCycle[(sideCycle.indexOf(side) + 1) % 3]!;
  const teamSize = view.definition.seats.sides[placement] ?? 0;
  const position = participant.positionOpen ? '?' : participant.seat.slot;
  const nextPosition =
    position === '?' ? 0 : position + 1 < teamSize ? position + 1 : null;
  return {
    team: participant.teamOpen ? '?' : team,
    side,
    position,
    mayMove,
    maySetSide,
    next: {
      team: participant.teamOpen ? 1 : team === 1 ? 2 : null,
      teamOneSide:
        nextSide === '?' ? null : team === 1 ? nextSide : opposite(nextSide),
      position: nextPosition,
    },
  };
}

export const sideLabels: Readonly<Record<SideMark, string>> = {
  [affirmativeSide]: 'Aff',
  [negativeSide]: 'Neg',
  '?': '?',
};

/** "1st", "2nd", "3rd", "4th": a speaking position as a debater reads it. */
export const ordinalOf = (position: number) => {
  const n = position + 1;
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ??
        'th');
  return `${n}${suffix}`;
};
