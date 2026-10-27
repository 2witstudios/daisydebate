import { and, eq, inArray } from 'drizzle-orm';
import { rooms } from './schema/rooms';

/**
 * Rooms' own vocabulary for a room still gathering its players (ADR 0070):
 * the only rooms a challenge or an invite may point at.
 */
const openRoomStatuses: ('assembling' | 'ready')[] = ['assembling', 'ready'];

/** Whether the `rooms` row in the query is still open. */
export const roomIsOpen = () => inArray(rooms.status, openRoomStatuses);

/** Whether room `roomId` is open and hosted by `actorId`. */
export const openRoomHostedBy = (roomId: string, actorId: string) =>
  and(eq(rooms.id, roomId), eq(rooms.hostActorId, actorId), roomIsOpen());
