import { isNamedSeat } from '@daisy/protocol/round-view';
import { type RoomView } from '@daisy/protocol/room-contract';
import {
  roomCommunitySeatReadsOnly,
  youthRoomOf,
} from '@daisy/protocol/room-community';

/**
 * Why this viewer reads Room chat without posting, as the Room view shows it:
 * `judge` for their own judge seat (DEC-174), `spectator` for a seatless
 * viewer of a Youth Room who does not host it (decision 84), else null. Only a
 * hint, for a chat nobody has opened yet and for the words of the read-only
 * notice: the view cannot see club staff, so the chat's own authority decides
 * every request and its metadata says whether this viewer posts.
 */
export const roomChatReaderOf = (
  view: Pick<RoomView, 'participants' | 'hostActorId' | 'ageRule'>,
  actorId: string,
): 'judge' | 'spectator' | null => {
  const named = view.participants.filter(isNamedSeat);
  const own = named.find((seat) => seat.actorId === actorId)?.seat.kind;
  if (roomCommunitySeatReadsOnly(own ?? null)) return 'judge';
  if (own !== undefined || view.hostActorId === actorId) return null;
  return youthRoomOf(view) ? 'spectator' : null;
};

/**
 * The Room page's read-only hint until the chat is found: a judge's seat
 * decides at once, and a Youth Room spectator holds it only while the server's
 * first paint said so too, because only the server sees a youth debater's club
 * staff. Once found, the chat's own metadata decides the composer.
 */
export const roomChatHintOf = (
  reader: 'judge' | 'spectator' | null,
  serverReadsOnly: boolean,
): boolean => reader === 'judge' || (reader === 'spectator' && serverReadsOnly);
