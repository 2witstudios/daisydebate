import { z } from 'zod';
import { idSchema } from '../primitives';
const messagingInboxEntrySchema = z.strictObject({
  channelId: idSchema,
  kind: z.enum([
    'conversation',
    'group_conversation',
    'incoming_request',
    'outgoing_request',
    'incoming_invitation',
  ]),
});
/** Pagination bounds are the explicit owning policy, never a navigation grant. */
export function createMessagingInboxSchemas(maxItems: number) {
  z.number().int().positive().safe().parse(maxItems);
  return {
    query: z.strictObject({
      version: z.literal(1),
      after: idSchema.optional(),
    }),
    result: z.strictObject({
      version: z.literal(1),
      entries: z.array(messagingInboxEntrySchema).max(maxItems),
      nextAfter: idSchema.nullable(),
    }),
  };
}
