import type { ContextChatMessage } from '../../features/messaging/context-chat/history';
export type ContextChatAvailableMessage = Exclude<
  ContextChatMessage,
  { readonly unavailable: true }
>;
export type ContextChatMessageRow = {
  readonly id: string;
  readonly sequence: number;
} & (
  | {
      readonly body: ContextChatMessage;
      readonly control: ContextChatAvailableMessage | null;
    }
  | { readonly body: null; readonly control: ContextChatAvailableMessage }
);
/** Own form anchors are local input, never authority to restore a withdrawn message body. */
export function contextChatMessageRows({
  actorId,
  channelId,
  messages,
  held,
}: {
  readonly actorId: string;
  readonly channelId: string;
  readonly messages: readonly ContextChatMessage[];
  readonly held: readonly ContextChatAvailableMessage[];
}): readonly ContextChatMessageRow[] {
  const rows = new Map<string, ContextChatMessageRow>();
  for (const message of held)
    if (message.authorActorId === actorId && message.channelId === channelId)
      rows.set(message.id, {
        id: message.id,
        sequence: message.sequence,
        body: null,
        control: message,
      });
  for (const message of messages)
    if (message.channelId === channelId)
      rows.set(message.id, {
        id: message.id,
        sequence: message.sequence,
        body: message,
        control:
          'unavailable' in message
            ? (rows.get(message.id)?.control ?? null)
            : message,
      });
  return [...rows.values()].sort((a, b) => a.sequence - b.sequence);
}
