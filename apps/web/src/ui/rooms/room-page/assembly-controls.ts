import { formatSeatsSchema } from '@daisy/protocol';
import type { RoomView } from '@daisy/protocol';

type Role = RoomView['participants'][number]['role'];
export function declaredSeats(seats: RoomView['definition']['seats']) {
  if (!formatSeatsSchema.safeParse(seats).success)
    throw new Error('Invalid room seats');
  return (['affirmative', 'negative', 'judge'] as const).flatMap((role) =>
    Array.from({ length: seats[role] }, (_, slot) => ({ role, slot })),
  );
}

export type LocalReadiness = {
  readonly devicesPassed: boolean;
  readonly unreadyPending: boolean;
};
type ReadinessView = Pick<
  RoomView,
  'participants' | 'readiness' | 'version'
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
  if (own.role !== 'judge' && !local.devicesPassed)
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
  const own = view.participants.find((seat) => seat.actorId === actorId);
  if (!own || own.kind === 'bot' || !own.needsReady) return null;
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

export function seatLabel(role: Role, slot: number): string {
  const names = {
    affirmative: 'Affirmative',
    negative: 'Negative',
    judge: 'Judge',
  };
  return `${names[role]} ${slot + 1}`;
}
