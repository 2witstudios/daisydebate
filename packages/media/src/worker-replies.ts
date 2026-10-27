import { z } from 'zod';
import { idSchema, roundStatusSchema, segmentTypes } from '@daisy/protocol';
const iso = z.iso.datetime({ precision: 3 });
const version = z.number().int().nonnegative().max(2147483647);
/** The non-judge seats a worker sees, with their bound media identities. */
const seatsReply = z
  .array(
    z.strictObject({
      roundParticipantId: idSchema,
      kind: z.enum(['human', 'bot']),
      identity: idSchema.nullable(),
    }),
  )
  .max(256);
export const leaseReply = z.strictObject({
  epoch: version.positive(),
  expiresAt: iso,
});
export const tokenReply = z.strictObject({
  sessionId: idSchema,
  roomName: idSchema,
  identity: idSchema,
  url: z.string().url(),
  token: z.string().min(1).max(16384),
  expiresAt: iso,
});
export const captureStateReply = z.strictObject({
  roundId: idSchema,
  sessionId: idSchema,
  version: version.positive(),
  serverNow: iso,
  status: roundStatusSchema,
  transcriptAdmissionCutoff: iso.nullable(),
  participants: seatsReply,
  segment: z
    .strictObject({
      id: idSchema,
      sequence: version,
      type: z.enum(segmentTypes),
      startedAt: iso,
      endedAt: iso.nullable(),
      durationMs: z.number().int().positive(),
    })
    .nullable(),
  intervals: z
    .array(
      z.strictObject({
        id: idSchema,
        roundParticipantId: idSchema,
        startedAt: iso,
        endedAt: iso.nullable(),
        startedVersion: version.positive(),
        endedVersion: version.positive().nullable(),
      }),
    )
    .max(512),
  nextIntervalId: idSchema.nullable(),
});
export const captureMutationReply = z.strictObject({
  duplicate: z.boolean(),
  revision: version,
});
export const sealReply = z.strictObject({
  state: z.enum(['complete', 'partial']),
  revision: version,
});
/** A relay the server only acknowledges. */
export const acknowledgedReply = z.null();
/** The bot listener's own read (ISSUE-764): only what peer activity needs. */
export const botListenerStateReply = z.strictObject({
  roundId: idSchema,
  sessionId: idSchema,
  serverNow: iso,
  segment: z
    .strictObject({
      id: idSchema,
      type: z.enum(segmentTypes),
      endedAt: iso.nullable(),
    })
    .nullable(),
  participants: seatsReply,
});
