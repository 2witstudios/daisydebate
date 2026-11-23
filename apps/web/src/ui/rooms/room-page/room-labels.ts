import { isNamedSeat } from '@daisy/protocol/round-view';
import {
  isOpenRoomStatus,
  type RoomRefusal,
  type RoomView,
} from '@daisy/protocol/room-contract';
import {
  sameSeat,
  sideSeat,
  type SeatRef,
  type Side,
  type TwoSideKey,
} from '@daisy/protocol/seats';
import { seatTotalOf } from '@daisy/protocol/format-seating';
import {
  seatsTwoTeams,
  sideOfTeam,
  teamOfPlacement,
} from '@daisy/protocol/seat-draw';
import {
  strikeSummary,
  roundLength,
  ruleRows,
  type RuleRowInterruptions,
} from '../../../features/debate-room/vocabulary';
import { seatName, shapeLabel } from '../../../features/debate-room/seat-names';
import { roomStatusLabels } from '../../../features/rooms/status-labels';
import { roomVisibilityLabels } from '../../../features/rooms/room-visibility';
import { declaredSeats, seatLabel } from './assembly-controls';
import { ordinalOf, showsTeams } from './roster-seat';

type Participant = RoomView['participants'][number];
type Definition = Pick<RoomView['definition'], 'sides' | 'seats'>;

/** What a Room seat label needs to know (ADR 0145). */
export type SeatNaming = Pick<RoomView, 'teamOneSide' | 'status'> & {
  readonly definition: Definition;
};

/**
 * A Room seat's name. Before Start a debater seat's side is its team's
 * placement, not its side (ADR 0145): it is named by its side once the sides
 * are fixed, and by its team (and position, when a team seats several) while
 * they are open. A judge seat, a seat in a Room with no two teams, and every
 * seat after Start, is named as is. `single` drops the "1" from a seat its
 * kind (or side) declares once: "Judge", "Negative".
 */
export function roomSeatLabel(
  view: SeatNaming,
  seat: SeatRef,
  single = false,
): string {
  const named = (shown: SeatRef) =>
    single
      ? seatName(view.definition, shown)
      : seatLabel(view.definition.sides, shown);
  if (
    seat.kind !== 'side' ||
    !isOpenRoomStatus(view.status) ||
    !seatsTwoTeams(view.definition)
  )
    return named(seat);
  const team = teamOfPlacement(seat.side as TwoSideKey);
  if (view.teamOneSide !== null)
    return named(sideSeat(sideOfTeam(team, view.teamOneSide), seat.slot));
  return showsTeams(view.definition)
    ? `Team ${team} · ${ordinalOf(seat.slot)}`
    : `Team ${team}`;
}

/**
 * The seat a Room chat author holds, as this viewer may know it: "Negative 1 ·
 * host". Null for anyone the view does not name in a seat, so a visitor and an
 * anonymous judge (DEC-174) read the same.
 */
export function chatAuthorSeat(
  view: Pick<RoomView, 'participants' | 'hostActorId'> & SeatNaming,
  actorId: string,
): string | null {
  const seat = view.participants
    .filter(isNamedSeat)
    .find((member) => member.actorId === actorId);
  const parts = [
    ...(seat ? [roomSeatLabel(view, seat.seat)] : []),
    ...(view.hostActorId === actorId ? ['host'] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Who and what Launch still waits on, in seat order; empty once nothing does. */
export function waitingOn(
  view: Pick<RoomView, 'participants'> & SeatNaming,
  actorId: string,
): readonly string[] {
  return declaredSeats(view.definition).flatMap((seat) => {
    const occupant = view.participants.find((member) =>
      sameSeat(member.seat, seat),
    );
    if (!occupant) return [roomSeatLabel(view, seat, true)];
    if (!occupant.needsReady || occupant.ready === 'ready') return [];
    if (!isNamedSeat(occupant)) return ['Judge'];
    return [occupant.actorId === actorId ? 'You' : occupant.label];
  });
}

export const ROOM_SETUP_ID = 'room-setup';
/** Every way into Room setup is this fragment link, so it opens before hydration. */
export const ROOM_SETUP_HREF = `#${ROOM_SETUP_ID}`;

/** "Setting up · 1 of 3 seats filled": the room's one status line. */
export function roomStatus(
  view: Pick<RoomView, 'status' | 'participants'> & {
    readonly definition: Definition;
  },
): string {
  // Before Start, the seats say where the Room is; Start round is the host's
  // button under their tile, not a status.
  if (view.status !== 'assembling' && view.status !== 'ready')
    return roomStatusLabels[view.status];
  const seats = seatTotalOf(view.definition);
  return `${view.participants.length} of ${seats} seats filled`;
}

/** Host, who can join, and whether the result is ranked: the header's meta line. */
export function roomMeta(
  view: Pick<RoomView, 'hostLabel' | 'visibility' | 'competitionType'>,
): readonly string[] {
  return [
    // A Room no person hosts (a Tab event Room) names no host.
    ...(view.hostLabel ? [`Hosted by ${view.hostLabel}`] : []),
    roomVisibilityLabels[view.visibility],
    view.competitionType === 'ranked' ? 'Ranked' : 'Casual',
  ];
}

/** "1v1 · about 30 min": the format line, derived from the saved schedule. */
export function formatLine(
  view: Pick<RoomView, 'rules' | 'config'> & {
    readonly definition: Definition;
  },
): string {
  const { config } = view;
  return `${shapeLabel(view.definition)} · ${roundLength({
    speechesMs: view.rules.segments.map((segment) => segment.durationMs),
    countdownMs: config.speechTiming.countdownMs,
    preRoundPrepMs: config.preRoundPrep.enabled
      ? config.preRoundPrep.durationMs
      : 0,
    prepPerSideMs: config.inRoundPrep.enabled
      ? config.inRoundPrep.budgetMsPerSide
      : null,
    sideCount: view.definition.sides.length,
  })}`;
}

/** "Value", "Custom, based on NSDA Policy (CX)" or "Custom": what the room runs (FMT-4). */
export function formatTitle(format: RoomView['format']): string {
  if (format.standing.kind === 'standard') return format.name;
  return format.standing.basis
    ? `Custom, based on ${format.basis?.name ?? format.name}`
    : 'Custom';
}

const refusalText: Readonly<Record<RoomRefusal, string>> = {
  'version-conflict': 'the latest room changes',
  'host-required': 'the host',
  'room-closed': 'nothing: this room is closed',
  'illegal-config': 'round settings the format allows',
  'seat-unavailable': 'a free seat',
  'actor-ineligible': 'an eligible debater',
  'not-seated': 'every seat to be filled',
  'incomplete-cast': 'every seat to be filled',
  'not-ready': 'everyone to be ready',
  'resolution-not-released': 'the tournament to release the resolution',
  'readiness-unavailable': 'everyone’s camera and microphone check',
  'command-conflict': 'the latest room changes',
  'consent-conflict': 'the latest readiness changes',
  'active-room': 'everyone to leave their other rooms',
  'ballot-definition-unavailable': 'a valid pinned ballot for this room',
  'format-unavailable': 'a format that is currently offered',
  'ranked-unavailable': 'an active Ranked season',
  // A debater seat is for the Room's own lobby (ADR 0162).
  'other-division': 'a debater seat in your own lobby',
  'draw-unavailable': 'enough resolutions to draw from',
  'bots-busy': 'a free bot: bots are busy, try again shortly',
  'bot-debates-coming-soon': 'a person to debate: bot debates are coming soon',
  'ai-judge-premium':
    'a person to judge: AI judging on casual rounds is premium',
  'capture-premium':
    'the host to turn off broadcast and recording: they need a subscription',
  'capture-host-limit':
    'one of the host’s broadcast or recorded rounds to finish',
  'capture-capacity': 'a free broadcast slot: all are busy, try again shortly',
  'broadcast-private': 'a Room that is not private, to broadcast it',
  'content-waiver-required': 'the ranked content waiver to be signed',
  'capture-notice-changed': 'the latest recording notice to be read',
  'content-waiver-changed': 'the latest ranked content waiver to be signed',
};

/** Why Start round is refused, in words; never the raw refusal code. */
export function startRefusalText(refusal: RoomRefusal): string {
  return refusalText[refusal];
}

export function seatStatus(occupant: Participant | undefined): string {
  if (!occupant) return 'Open';
  if (!occupant.eligible) return 'Not eligible';
  if (!occupant.needsReady) return 'Always ready';
  if (occupant.ready === 'ready') return 'Ready';
  return occupant.ready === 'unavailable' ? 'Checking devices' : 'Not ready';
}

// Literal class names so the Tailwind scanner emits every step.
const growSteps = [
  'grow-1',
  'grow-2',
  'grow-3',
  'grow-4',
  'grow-5',
  'grow-6',
  'grow-7',
  'grow-8',
  'grow-9',
  'grow-10',
  'grow-11',
  'grow-12',
] as const;

/** A speech's share of the schedule bar: whole minutes, one through twelve. */
export function speechGrow(durationMs: number): (typeof growSteps)[number] {
  const minutes = Math.round(durationMs / 60000);
  return growSteps[Math.min(Math.max(minutes, 1), growSteps.length) - 1]!;
}

/** How a draw Room chooses its resolution, in one line; none without a draw. */
function strikeRows(
  draw: RoomView['config']['resolutionDraw'],
  sides: readonly Side[],
): readonly (readonly [string, string])[] {
  return draw.enabled
    ? [['Resolution strike', strikeSummary(draw, sides)]]
    : [];
}

/** The saved configuration as label/value rows, in the room's vocabulary. */
const interruptionRow = (
  settings: RoomView['config']['interruptions'],
): RuleRowInterruptions => {
  if (settings === null) return { mode: 'disabled' };
  const { mode, minRemainingMs } = settings;
  return mode === 'enabled' ? { mode, minRemainingMs } : { mode };
};

export function settingRows(
  view: Pick<RoomView, 'config'> & {
    readonly rules: { readonly sides: readonly Side[] };
  },
): readonly (readonly [string, string])[] {
  const { config } = view;
  return [
    ...strikeRows(config.resolutionDraw, view.rules.sides),
    ...ruleRows({
      preRoundPrepMs: config.preRoundPrep.enabled
        ? config.preRoundPrep.durationMs
        : null,
      prepPerSideMs: config.inRoundPrep.enabled
        ? config.inRoundPrep.budgetMsPerSide
        : null,
      countdownMs: config.speechTiming.countdownMs,
      interruptions: interruptionRow(config.interruptions),
      yielding: config.yielding,
    }),
  ];
}
