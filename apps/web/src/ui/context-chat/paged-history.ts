import type { ContextChatOlderPages } from '../../features/messaging/context-chat/chat-state';
import type { MessagingConversation } from '../../features/messaging/conversation';
import { mergeContextChatMessages } from '../../features/messaging/context-chat/history';

/** A live change can remove text outside the latest page; older text needs a fresh protected read. */
export function contextChatPagedHistory(
  latest: MessagingConversation,
  older: ContextChatOlderPages | null,
) {
  const current = older?.changeVersion === latest.changeVersion ? older : null;
  return {
    messages: mergeContextChatMessages(
      latest.channelId,
      current?.messages ?? [],
      latest.messages,
    ),
    before: current ? current.before : (latest.nextBefore?.sequence ?? null),
  };
}
