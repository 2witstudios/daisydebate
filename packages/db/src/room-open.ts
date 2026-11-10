import { and, eq, inArray } from 'drizzle-orm';
import { openRoomStatuses } from '@daisy/protocol';
import { rooms } from './schema/rooms';

/** Whether the `rooms` row in the query is still open. */
export const roomIsOpen = () => inArray(rooms.status, [...openRoomStatuses]);

/** Whether room `roomId` is open and hosted by `actorId`. */
export const openRoomHostedBy = (roomId: string, actorId: string) =>
  and(eq(rooms.id, roomId), eq(rooms.hostActorId, actorId), roomIsOpen());
