import { z } from 'zod';
import { realtimePublicUrlSchema } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import {
  createMessagingCoreSchemas,
  messagingTypingSchemas,
} from '@daisy/protocol';

export type MessagingConversation = z.infer<
  ReturnType<typeof createMessagingCoreSchemas>['historyResult']
>;

/** The browser/server-render adapter validates the authorized wire response. */
export async function readConversationResponse(response: Response) {
  if (!response.ok) return null;
  const positive = z.coerce.number().int().positive().safe();
  const parsedBounds = z
    .object({ messageUnits: positive, pageItems: positive })
    .safeParse({
      messageUnits: response.headers.get('x-messaging-message-units'),
      pageItems: response.headers.get('x-messaging-page-items'),
    });
  if (!parsedBounds.success) throw createAppError('INFRASTRUCTURE');
  const bounds = parsedBounds.data;
  const history = createMessagingCoreSchemas(bounds).historyResult.safeParse(
    await response.json(),
  );
  if (!history.success) throw createAppError('INFRASTRUCTURE');
  const endpoint = response.headers.get('x-realtime-socket-url');
  const socketUrl =
    endpoint === null ? null : realtimePublicUrlSchema.parse(endpoint);
  const configured = response.headers.get('x-messaging-typing-refetch-ms');
  const recovery =
    configured === null
      ? null
      : messagingTypingSchemas.result.shape.refreshAfterMs.safeParse(
          Number(configured),
          { jitless: true },
        );
  if (recovery !== null && !recovery.success)
    throw createAppError('INFRASTRUCTURE');
  return {
    history: history.data,
    bounds,
    socketUrl,
    typingRefetchMs: recovery?.data ?? null,
  };
}
