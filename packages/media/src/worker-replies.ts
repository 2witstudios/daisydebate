import { z } from 'zod';
import { idSchema, roundStatusSchema, segmentTypes } from '@daisy/protocol';
const iso = z.iso.datetime({ precision: 3 });
const version = z.number().int().nonnegative().max(2147483647);
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
  participants: z
    .array(
      z.strictObject({
        roundParticipantId: idSchema,
        kind: z.enum(['human', 'bot']),
        identity: idSchema.nullable(),
      }),
    )
    .max(256),
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
