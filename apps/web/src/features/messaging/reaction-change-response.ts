import {
  createMessagingReactionResultSchema,
  messagingReactionMaxUnits,
} from '@daisy/protocol';

/** The accepted aggregate belongs to this message, never an unrelated answer. */
export async function readReactionChangeResponse(
  response: Response,
  scope: { readonly channelId: string; readonly messageId: string },
) {
  if (!response.ok) return null;
  try {
    const result = createMessagingReactionResultSchema(
      messagingReactionMaxUnits,
    ).safeParse(await response.json());
    return result.success &&
      result.data.channelId === scope.channelId &&
      result.data.messageId === scope.messageId
      ? result.data
      : null;
  } catch {
    return null;
  }
}
