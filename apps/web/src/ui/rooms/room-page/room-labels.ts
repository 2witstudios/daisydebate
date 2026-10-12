import type { RoomView } from '@daisy/protocol';
import { clockDuration } from '../../../features/rooms/duration-input';
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
      return [occupant.actorId === actorId ? 'You' : occupant.label];
    },
  );
  const prepRunning = view.prep.startedAt !== null && !view.prep.finished;
  return prepRunning ? [...seats, 'Preparation'] : seats;
}

const statusLabels = {
  assembling: 'Before the round',
  ready: 'Ready to launch',
  started: 'Round started',
  abandoned: 'Closed',
} as const;
const competitionLabels = {
  ranked: 'Ranked',
  casual: 'Casual',
  practice: 'Practice',
} as const;

/** Status, shape and length, competition type: the room header chips. */
export function roomChips(
  view: Pick<RoomView, 'status' | 'definition' | 'length' | 'competitionType'>,
): readonly [string, string, string] {
  const { affirmative, negative } = view.definition.seats;
  const shape =
    affirmative === 1 && negative === 1
      ? 'One-on-one'
      : `${affirmative} v ${negative}`;
  return [
    statusLabels[view.status],
    `${shape} · ${view.length === 'full' ? 'Full' : 'Quick'}`,
    competitionLabels[view.competitionType],
  ];
}

export function seatStatus(occupant: Participant | undefined): string {
  if (!occupant) return 'Open';
  if (!occupant.eligible) return 'Not eligible';
  if (!occupant.needsReady) return 'Server managed';
  if (occupant.ready === 'ready') return 'Ready';
  return occupant.ready === 'unavailable'
    ? 'Readiness unavailable'
    : 'Not ready';
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

const interruptionLabels = {
  disabled: 'Off',
  cross_ex_only: 'Cross-ex only',
  enabled: 'Allowed',
} as const;

function yieldLabel(yielding: RoomView['config']['yielding']): string {
  if (!yielding?.allowed) return 'Off';
  return yielding.returnsTime ? 'Returns time' : 'Allowed';
}

/** The saved configuration as label/value rows. */
export function settingRows(
  view: Pick<RoomView, 'config'>,
): readonly (readonly [string, string])[] {
  const { config } = view;
  const interruptions = config.interruptions;
  return [
    [
      'Before the round',
      config.preRoundPrep.enabled
        ? clockDuration(config.preRoundPrep.durationMs)
        : 'Off',
    ],
    [
      'Prep',
      config.inRoundPrep.enabled
        ? `${clockDuration(config.inRoundPrep.budgetMsPerSide)} each`
        : 'Off',
    ],
    ['Countdown', clockDuration(config.speechTiming.countdownMs)],
    [
      'Cross-ex',
      config.crossExamination.crossExMode === 'ordered' ? 'Ordered' : 'Free',
    ],
    ['Interruptions', interruptionLabels[interruptions?.mode ?? 'disabled']],
    ...(interruptions && interruptions.mode !== 'disabled'
      ? [
          [
            'Minimum remaining',
            clockDuration(interruptions.minRemainingMs),
          ] as const,
        ]
      : []),
    ['Yield', yieldLabel(config.yielding)],
  ];
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
