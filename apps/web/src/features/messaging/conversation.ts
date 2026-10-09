import { z } from 'zod';
import { realtimePublicUrlSchema } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { createMessagingCoreSchemas } from '@daisy/protocol';

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
  return { history: history.data, bounds, socketUrl };
}
