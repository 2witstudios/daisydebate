import { z } from 'zod';
import { idSchema } from './primitives';
import { evidenceEnvelopeSchema } from './evidence-envelope';
import {
  evidenceRefusalReasons,
  type NecessaryEvidenceIngressReply,
} from './necessary-evidence';
/** Historical committed payload receipt only; a pending/key receipt never acknowledges PCM release. */
export const evidenceIngressReplySchema: z.ZodType<NecessaryEvidenceIngressReply> =
  z.union([
    z
      .strictObject({
        kind: z.literal('received'),
        evidenceId: idSchema,
        bindingDigest: z.string().regex(/^[a-f0-9]{64}$/),
        payloadAcceptedAt: z.iso.datetime({ precision: 3 }),
        receipt: evidenceEnvelopeSchema.shape.receipt,
      })
      .refine(
        (reply) =>
          reply.evidenceId === reply.receipt.evidenceId &&
          reply.bindingDigest === reply.receipt.bindingDigest &&
          Date.parse(reply.payloadAcceptedAt) >= reply.receipt.receivedAtMs &&
          Date.parse(reply.payloadAcceptedAt) < reply.receipt.expiresAtMs,
      ),
    z.strictObject({ kind: z.literal('pending'), evidenceId: idSchema }),
    z.strictObject({
      kind: z.literal('refused'),
      reason: z.enum(evidenceRefusalReasons),
    }),
  ]);
