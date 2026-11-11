import { and, eq, inArray, type SQLWrapper } from 'drizzle-orm';
import { openRoomStatuses } from '@daisy/protocol';
import { rooms } from './schema/rooms';

/**
 * Whether the `rooms` row in the query is still open. `status` names that
 * row's status where the query reads `rooms` under an alias.
 */
export const roomIsOpen = (status: SQLWrapper = rooms.status) =>
  inArray(status, [...openRoomStatuses]);

/** Whether room `roomId` is open and hosted by `actorId`. */
export const openRoomHostedBy = (roomId: string, actorId: string) =>
  and(eq(rooms.id, roomId), eq(rooms.hostActorId, actorId), roomIsOpen());
