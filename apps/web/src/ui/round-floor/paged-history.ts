import type { MessagingConversation } from '../../features/messaging/conversation';
import {
  mergeFloorMessages,
  type FloorMessage,
} from '../../features/messaging/round-floor/history';

export type FloorOlderPages = {
  readonly changeVersion: number;
  readonly messages: readonly FloorMessage[];
  readonly before: number | null;
};
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
