import type { FloorMessage } from '../../features/messaging/round-floor/history';
export type FloorAvailableMessage = Exclude<
  FloorMessage,
  { readonly unavailable: true }
>;
export type FloorMessageRow = {
  readonly id: string;
  readonly sequence: number;
} & (
  | {
      readonly body: FloorMessage;
      readonly control: FloorAvailableMessage | null;
    }
  | { readonly body: null; readonly control: FloorAvailableMessage }
);
/** Own form anchors are local input, never authority to restore a withdrawn message body. */
export function floorMessageRows({
  actorId,
  channelId,
  messages,
  held,
}: {
  readonly actorId: string;
  readonly channelId: string;
  readonly messages: readonly FloorMessage[];
  readonly held: readonly FloorAvailableMessage[];
}): readonly FloorMessageRow[] {
  const rows = new Map<string, FloorMessageRow>();
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
