import { z } from 'zod';

/**
 * What a platform incident's refusal tells a bot seat: which incident holds it, and how much
 * speech went out with no capture confirming it, into a room that may have been dead.
 */
export const botSpeechHoldSchema = z.strictObject({
  since: z.iso.datetime(),
  unheardMs: z.int().min(0),
});
export type BotSpeechHold = z.infer<typeof botSpeechHoldSchema>;
