import { isNamedSeat, type RoomRefusal, type RoomView } from '@daisy/protocol';
import {
  roundLength,
  ruleRows,
  shapeLabel,
} from '../../../features/debate-room/vocabulary';
import { roomStatusLabels } from '../../../features/rooms/status-labels';
import { declaredSeats, seatLabel } from './assembly-controls';

type Role = RoomView['participants'][number]['role'];
type Participant = RoomView['participants'][number];

/** "Judge" when the role has one seat, "Negative 2" when it has several. */
function seatName(
  seats: RoomView['definition']['seats'],
  role: Role,
  slot: number,
): string {
  const label = seatLabel(role, slot);
  return seats[role] === 1 ? label.replace(/ 1$/, '') : label;
}

/** Who and what Launch still waits on, in seat order; empty once nothing does. */
export function waitingOn(
  view: Pick<RoomView, 'participants' | 'prep'> & {
    readonly definition: Pick<RoomView['definition'], 'seats'>;
  },
  actorId: string,
): readonly string[] {
  const seats = declaredSeats(view.definition.seats).flatMap(
    ({ role, slot }) => {
      const occupant = view.participants.find(
        (seat) => seat.role === role && seat.slot === slot,
      );
      if (!occupant) return [seatName(view.definition.seats, role, slot)];
      if (!occupant.needsReady || occupant.ready === 'ready') return [];
      if (!isNamedSeat(occupant)) return ['Judge'];
      return [occupant.actorId === actorId ? 'You' : occupant.label];
    },
  );
  const prepRunning = view.prep.startedAt !== null && !view.prep.finished;
  return prepRunning ? [...seats, 'Prep before the round'] : seats;
}

export const ROOM_SETUP_ID = 'room-setup';
/** Every way into Room setup is this fragment link, so it opens without script. */
export const ROOM_SETUP_HREF = `#${ROOM_SETUP_ID}`;

/** "Setting up · 1 of 3 seats filled": the room's one status line. */
export function roomStatus(
  view: Pick<RoomView, 'status' | 'participants'> & {
    readonly definition: Pick<RoomView['definition'], 'seats'>;
  },
): string {
  const status = roomStatusLabels[view.status];
  if (view.status !== 'assembling') return status;
  const { affirmative, negative, judge } = view.definition.seats;
  const seats = affirmative + negative + judge;
  return `${status} · ${view.participants.length} of ${seats} seats filled`;
}

const visibilityLabels = {
  public: 'Listed in the lobby',
  unlisted: 'Anyone with the link',
  private: 'Invite only',
} as const;
const competitionLabels = {
  ranked: 'Ranked · counts toward ratings',
  casual: 'Casual · ratings don’t change',
} as const;

/** Host, who can join, and whether the result is rated: the header's meta line. */
export function roomMeta(
  view: Pick<RoomView, 'hostLabel' | 'visibility' | 'competitionType'>,
): readonly string[] {
  return [
    ...(view.hostLabel === null ? [] : [`Hosted by ${view.hostLabel}`]),
    visibilityLabels[view.visibility],
    competitionLabels[view.competitionType],
  ];
}

/** "1v1 · about 30 min": the format line, derived from the saved schedule. */
export function formatLine(
  view: Pick<RoomView, 'rules' | 'config'> & {
    readonly definition: Pick<RoomView['definition'], 'seats'>;
  },
): string {
  const { config } = view;
  return `${shapeLabel(view.definition.seats)} · ${roundLength({
    speechesMs: view.rules.segments.map((segment) => segment.durationMs),
    countdownMs: config.speechTiming.countdownMs,
    prepPerSideMs: config.inRoundPrep.enabled
      ? config.inRoundPrep.budgetMsPerSide
      : null,
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
  'seat-unavailable': 'an open seat',
  'actor-ineligible': 'an eligible debater',
  'not-seated': 'every seat to be filled',
  'incomplete-cast': 'every seat to be filled',
  'not-ready': 'everyone to be ready',
  'readiness-unavailable': 'everyone’s camera and microphone check',
  'prep-running': 'prep before the round to finish',
  'prep-unavailable': 'prep before the round',
  'command-conflict': 'the latest room changes',
  'consent-conflict': 'the latest readiness changes',
  'active-room': 'everyone to leave their other rooms',
  'format-unavailable': 'a format that is currently offered',
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

/** The saved configuration as label/value rows, in the room's vocabulary. */
export function settingRows(
  view: Pick<RoomView, 'config'>,
): readonly (readonly [string, string])[] {
  const { config } = view;
  return ruleRows({
    preRoundPrepMs: config.preRoundPrep.enabled
      ? config.preRoundPrep.durationMs
      : null,
    prepPerSideMs: config.inRoundPrep.enabled
      ? config.inRoundPrep.budgetMsPerSide
      : null,
    countdownMs: config.speechTiming.countdownMs,
    crossExMode: config.crossExamination.crossExMode,
    interruptions: config.interruptions,
    yielding: config.yielding,
  });
}

/** "Maya Okafor" → "MO": an avatar's two initials. */
export function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toLocaleUpperCase())
    .join('');
}
