import { isNamedSeat, formatSeatsSchema } from '@daisy/protocol';
import type { RoomView } from '@daisy/protocol';

type Role = RoomView['participants'][number]['role'];
export function declaredSeats(seats: RoomView['definition']['seats']) {
  if (!formatSeatsSchema.safeParse(seats).success)
    throw new Error('Invalid room seats');
  return (['affirmative', 'negative', 'judge'] as const).flatMap((role) =>
    Array.from({ length: seats[role] }, (_, slot) => ({ role, slot })),
  );
}

/** The viewer's own named seat in the Room, if they hold one. */
export const ownSeat = (
  view: Pick<RoomView, 'participants'>,
  actorId: string,
) =>
  view.participants
    .filter(isNamedSeat)
    .find((seat) => seat.actorId === actorId);

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

/** Why Ready is refused, in order: the first failing check wins. */
type ReadyBlocker = 'unavailable' | 'ineligible' | 'waiver' | 'devices';
const blockerText: Readonly<Record<ReadyBlocker, string>> = {
  unavailable: 'Readiness is unavailable. Refresh the room and try again.',
  ineligible: 'This seat is not eligible to ready.',
  waiver: 'Sign the ranked content waiver before readying.',
  devices: 'Check your camera and microphone before readying.',
};

function readyBlocker(
  view: ReadinessView,
  own: RoomView['participants'][number],
  local: LocalReadiness,
): ReadyBlocker | null {
  if (!view.readiness.available || view.readiness.version !== view.version)
    return 'unavailable';
  if (!own.eligible || !view.capabilities.canReady) return 'ineligible';
  if (view.contentWaiver === 'unsigned') return 'waiver';
  if (own.role !== 'judge' && !local.devicesPassed) return 'devices';
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
  blocker: ReadyBlocker | null;
} | null {
  const own = ownSeat(view, actorId);
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
      blocker: null,
    };
  if (own.ready === 'ready')
    return { type: 'unready', enabled: true, reason: null, blocker: null };
  const blocker = readyBlocker(view, own, local);
  return {
    type: 'ready',
    enabled: blocker === null,
    reason: blocker ? blockerText[blocker] : null,
    blocker,
  };
}

export function seatLabel(role: Role, slot: number): string {
  const names = {
    affirmative: 'Affirmative',
    negative: 'Negative',
    judge: 'Judge',
  };
  return `${names[role]} ${slot + 1}`;
}
