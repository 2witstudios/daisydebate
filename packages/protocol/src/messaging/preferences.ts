import { z } from 'zod';
import { idSchema } from '../primitives';
const scope = { version: z.literal(1), channelId: idSchema };
const selections = {
  following: z.boolean(),
  hidden: z.boolean(),
  notificationLevel: z.enum(['all', 'mentions', 'none']),
};
/** Preferences convey intent only, never membership or content permission. */
export const messagingPreferenceSchemas = {
  scope: z.strictObject(scope),
  update: z.strictObject({ ...scope, ...selections }),
  result: z.strictObject({
    ...scope,
    state: z
      .strictObject({
        ...selections,
        readSequence: z.number().int().nonnegative().safe(),
      })
      .nullable(),
    unread: z.number().int().nonnegative().safe(),
  }),
  cleared: z.strictObject({ ...scope, cleared: z.boolean() }),
};
