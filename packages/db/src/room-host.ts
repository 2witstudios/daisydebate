import { createAppError } from '@daisy/errors';

/**
 * The host person of a Room, or null for a Room no person hosts (TAB-6). A
 * Room in a standing lobby has a host; one in a tournament lobby has none
 * (`rooms_host_by_lobby_kind`): authority over it comes from grants on the
 * lobby, and the engine refuses its host-only commands. A row whose host
 * disagrees with its lobby's kind is corruption, refused here rather than
 * read as either kind of Room.
 */
export const hostPersonOf = (room: {
  readonly id: string;
  readonly hostActorId: string | null;
  readonly lobbyKind: 'standing' | 'tournament';
}): string | null => {
  if ((room.hostActorId === null) !== (room.lobbyKind === 'tournament'))
    throw createAppError(
      'INVARIANT',
      `Room ${room.id} has a host exactly when its lobby is standing`,
    );
  return room.hostActorId;
};
