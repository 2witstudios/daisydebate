import { isNamedSeat, type RoomView } from '@daisy/protocol';
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
  view: Pick<RoomView, 'participants' | 'hostActorId' | 'competitionType'>,
  actorId: string,
): 'judge' | 'spectator' | null => {
  const named = view.participants.filter(isNamedSeat);
  const own = named.find((seat) => seat.actorId === actorId)?.seat.kind;
  if (roomCommunitySeatReadsOnly(own ?? null)) return 'judge';
  if (own !== undefined || view.hostActorId === actorId) return null;
  return youthRoomOf({
    competitionType: view.competitionType,
    participants: named,
  })
    ? 'spectator'
    : null;
};

/**
 * The live Room page's chat hint, from the synced view and the server's first
 * paint. A judge's seat decides at once. A Youth Room spectator's hint holds
 * only while the first paint read them read-only as a spectator too, because
 * only the server sees a youth debater's club staff: a viewer the server let
 * post keeps the composer, and so does one whose first paint was read-only for
 * another reason (a judge seat since left). The chat's metadata, re-read as
 * the Room changes, says the rest.
 */
export const roomChatHint = (
  view: Parameters<typeof roomChatReaderOf>[0],
  actorId: string,
  firstPaint: {
    readonly readOnlyHint: boolean;
    readonly reader?: 'judge' | 'spectator' | null;
  },
) => {
  const reader = roomChatReaderOf(view, actorId);
  return {
    reader,
    readOnlyHint:
      reader === 'judge' ||
      (reader === 'spectator' &&
        firstPaint.readOnlyHint &&
        firstPaint.reader === 'spectator'),
  };
};
