import type { RoomView } from '@daisy/protocol';
/** Display eligibility is also checked against a fresh authorized source before creation. */
export const canOfferFreshRoom = (
  source: Pick<RoomView, 'status' | 'roundRef' | 'hostActorId'>,
  actorId: string,
) =>
  source.hostActorId === actorId &&
  source.status === 'started' &&
  (source.roundRef?.status === 'completed' ||
    source.roundRef?.status === 'abandoned');
