import { sampleMyDebates } from '../../ui/mock/my-debates';
import { getRoomInfo } from '../rooms/get-room';
import type { RoomInfo } from '../rooms/view';

/**
 * The debate page's one data seam: which debate this is. A debate opens from
 * its room, so a room's sample is a debate, and so is each finished debate in
 * the account's history; the backend read of a debate and its start time
 * replaces this function and nothing else.
 */
export function getDebateInfo(id: string, now: string): RoomInfo | null {
  const room = getRoomInfo(id, now);
  if (room !== null) return room;
  const past = sampleMyDebates(now).find((debate) => debate.id === id);
  return past === undefined
    ? null
    : {
        id,
        title: past.title,
        mode: past.mode,
        hostHandle: past.opponent,
      };
}
