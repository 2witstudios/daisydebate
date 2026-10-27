import { z } from 'zod';
import { idSchema } from '../primitives';

const instant = z.iso.datetime();

/**
 * DEC-126: what a survivor sees of a DM whose other member was erased: only
 * their own messages, with no counterpart, sequence or unread state.
 */
export const messagingRetainedSchemas = {
  list: z.strictObject({
    version: z.literal(1),
    conversations: z.array(
      z.strictObject({
        channelId: idSchema,
        messages: z.number().int().positive().safe(),
        lastAt: instant,
      }),
    ),
  }),
  conversation: z.strictObject({
    version: z.literal(1),
    channelId: idSchema,
    messages: z.array(
      z.strictObject({
        id: idSchema,
        text: z.string(),
        createdAt: instant,
        editedAt: instant.nullable(),
      }),
    ),
  }),
  remove: z.strictObject({ version: z.literal(1), channelId: idSchema }),
};
