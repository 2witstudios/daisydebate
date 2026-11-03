import type { RoomView } from '@daisy/protocol';
import { liveHref } from '../watch/routes';

/**
 * Where a Room leads once its Round exists. A seat or the host goes to the
 * Round's own page; anyone else watches it on the public page, which is the
 * only one that shows them a Round in play.
 */
export const roundLinkOf = (
  view: Pick<
    RoomView,
    'roundRef' | 'hostActorId' | 'participants' | 'visibility'
  >,
  actorId: string,
): string | null => {
  const { roundRef: round } = view;
  if (!round) return null;
  const inside =
    view.hostActorId === actorId ||
    view.participants.some(
      (seat) => 'actorId' in seat && seat.actorId === actorId,
    );
  return inside || view.visibility !== 'public'
    ? `/rounds/${round.id}`
    : liveHref(round.id);
};
