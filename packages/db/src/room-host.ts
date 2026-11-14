import { createAppError } from '@daisy/errors';

/**
 * The host person of a Room in a standing lobby. A Room in a tournament
 * lobby has none (`rooms_host_by_lobby_kind`): authority over it comes from
 * grants on the lobby. The Room aggregate these readers hydrate is the
 * hosted one, so an event Room reaching them is a defect, refused here
 * rather than read as a Room with an empty host.
 */
export const hostPersonOf = (room: {
  readonly id: string;
  readonly hostActorId: string | null;
}): string => {
  if (room.hostActorId === null)
    throw createAppError(
      'INVARIANT',
      `Room ${room.id} has no host person: it is an event Room`,
    );
  return room.hostActorId;
};
