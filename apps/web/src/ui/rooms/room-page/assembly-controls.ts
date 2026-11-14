import {
  everySeatOf,
  formatSeatsSchema,
  isJudgeSeat,
  isNamedSeat,
  leadSeatOf,
  seatLabel as protocolSeatLabel,
  type FormatSeating,
  type RoomView,
  type SeatRef,
  type Side,
  type SpeakRights,
} from '@daisy/protocol';

/** Every seat the format declares, in seat order: sides as declared, speakers, moderator, judges. */
export function declaredSeats(seating: FormatSeating): readonly SeatRef[] {
  if (!formatSeatsSchema.safeParse(seating.seats).success)
    throw new Error('Invalid room seats');
  return everySeatOf(seating);
}

export type LocalReadiness = {
  readonly devicesPassed: boolean;
  readonly unreadyPending: boolean;
};
type ReadinessView = Pick<
  RoomView,
  'participants' | 'readiness' | 'version' | 'contentWaiver'
> & {
  readonly capabilities: Pick<RoomView['capabilities'], 'canReady'>;
};

function readyRefusal(
  view: ReadinessView,
  own: RoomView['participants'][number],
  local: LocalReadiness,
): string | null {
  if (!view.readiness.available || view.readiness.version !== view.version)
    return 'Readiness is unavailable. Refresh the room and try again.';
  if (!own.eligible || !view.capabilities.canReady)
    return 'This seat is not eligible to ready.';
  if (view.contentWaiver === 'unsigned')
    return 'Sign the ranked content waiver before readying.';
  if (!isJudgeSeat(own.seat) && !local.devicesPassed)
    return 'Check your camera and microphone before readying.';
  return null;
}

/** Presentation only: CAP owns effective consent; VIDEO owns local checks. */
export function readinessControl(
  view: ReadinessView,
  actorId: string,
  local: LocalReadiness,
): {
  type: 'ready' | 'unready';
  enabled: boolean;
  reason: string | null;
} | null {
  const own = view.participants
    .filter(isNamedSeat)
    .find((seat) => seat.actorId === actorId);
  if (
    !own ||
    own.kind === 'bot' ||
    !own.needsReady ||
    !view.capabilities.canReady
  )
    return null;
  if (local.unreadyPending)
    return {
      type: 'unready',
      enabled: true,
      reason: 'Not ready requested. Waiting for server confirmation.',
    };
  if (own.ready === 'ready')
    return { type: 'unready', enabled: true, reason: null };
  const reason = readyRefusal(view, own, local);
  return { type: 'ready', enabled: reason === null, reason };
}

/** "Negative 1", "Judge 2": a seat by its format's name, always numbered. */
export function seatLabel(sides: readonly Side[], seat: SeatRef): string {
  return protocolSeatLabel(sides, seat, Number.POSITIVE_INFINITY);
}

/** The seat a segment is scheduled to, "Affirmative 1"; an open floor is everyone's. */
export function segmentSeatLabel(
  sides: readonly Side[],
  speak: SpeakRights,
): string {
  const lead = leadSeatOf(speak);
  return lead ? seatLabel(sides, lead) : 'Open floor';
}
