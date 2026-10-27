import { readActiveRoom } from '../../features/rooms/read-assembly';
import type { ActiveRoomSummary } from './your-room';

/** Refresh this bar's projection without refreshing the page's forms or live Round. */
export async function refreshActiveRoom(
  fetch: Parameters<typeof readActiveRoom>[0],
  signal: AbortSignal,
  adopt: (room: ActiveRoomSummary | null) => void,
) {
  const room = await readActiveRoom((path, init) =>
    fetch(path, { ...init, cache: 'no-store', signal }),
  );
  if (!signal.aborted) adopt(room);
}
