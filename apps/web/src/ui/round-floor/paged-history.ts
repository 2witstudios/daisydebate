import type { FloorOlderPages } from '../../features/messaging/round-floor/floor-state';
import type { MessagingConversation } from '../../features/messaging/conversation';
import { mergeFloorMessages } from '../../features/messaging/round-floor/history';

/** A live change can remove text outside the latest page; older text needs a fresh protected read. */
export function floorPagedHistory(
  latest: MessagingConversation,
  older: FloorOlderPages | null,
) {
  const current = older?.changeVersion === latest.changeVersion ? older : null;
  return {
    messages: mergeFloorMessages(
      latest.channelId,
      current?.messages ?? [],
      latest.messages,
    ),
    before: current ? current.before : (latest.nextBefore?.sequence ?? null),
  };
}
