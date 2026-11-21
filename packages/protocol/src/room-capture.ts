import { z } from 'zod';
import { broadcastReleasePolicySchema } from './broadcast';

/**
 * Who may watch a Room's Recording (TAB-6): none is made, only the officials
 * (judge and moderator seats, and the host) see it, or it is released as
 * Daisy releases any Recording. A ranked Round's is always released.
 */
const recordingPolicies = ['off', 'officials', 'released'] as const;
export const recordingPolicySchema = z.enum(recordingPolicies);
export type RecordingPolicy = (typeof recordingPolicies)[number];

/**
 * What a casual host opted this Room into (WATCH-8): a Broadcast with its
 * release choice, and a Recording policy, as two separate choices. A release choice
 * cannot exist without a Broadcast. Ranked capture is a fact of being ranked,
 * never a choice, so a ranked Room never holds one.
 */
export const roomCaptureSchema = z
  .strictObject({
    broadcast: z
      .strictObject({
        release: broadcastReleasePolicySchema,
        /** The host's off switch for debaters reading spectator chat. */
        debatersReadChat: z.boolean(),
      })
      .nullable(),
    recordingPolicy: recordingPolicySchema,
  })
  .refine(
    (capture) =>
      capture.recordingPolicy !== 'officials' || capture.broadcast === null,
    {
      message: 'A Recording kept for the officials has no Broadcast',
      path: ['broadcast'],
    },
  );
export type RoomCapture = z.infer<typeof roomCaptureSchema>;
