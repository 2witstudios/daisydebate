import { z } from 'zod';
import { broadcastReleasePolicySchema } from './broadcast';

/**
 * What a casual host opted this Room into (WATCH-8): a Broadcast with its
 * release choice, and a Recording, as two separate choices. A release choice
 * cannot exist without a Broadcast. Ranked capture is a fact of being ranked,
 * never a choice, so a ranked Room never holds one.
 */
export const roomCaptureSchema = z.strictObject({
  broadcast: z
    .strictObject({
      release: broadcastReleasePolicySchema,
      /** The host's off switch for debaters reading spectator chat. */
      debatersReadChat: z.boolean(),
    })
    .nullable(),
  recording: z.boolean(),
});
export type RoomCapture = z.infer<typeof roomCaptureSchema>;
