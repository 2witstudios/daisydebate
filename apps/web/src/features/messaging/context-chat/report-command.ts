import { idSchema } from '@daisy/protocol';
import { z } from 'zod';

/**
 * A report of one message in a context chat, as its route receives it. The
 * reason is checked against the closed chat-message set where it is used.
 */
export const contextChatReportSchema = z.strictObject({
  version: z.literal(1),
  channelId: idSchema,
  messageId: idSchema,
  reason: z.string(),
});
