import { z } from 'zod';
import { idSchema } from './primitives';
import { necessaryEvidencePolicy } from './necessary-evidence';

const bytes = (length: number, exact = false) =>
  z
    .instanceof(Uint8Array)
    .refine((value) =>
      exact
        ? value.byteLength === length
        : value.byteLength > 0 && value.byteLength <= length,
    );
/** Restored/serialized input is untrusted even when its TypeScript type is known. */
export const evidenceEnvelopeSchema = z.strictObject({
  kind: z.literal('sealed'),
  receipt: z
    .strictObject({
      evidenceId: idSchema,
      bindingDigest: z.string().regex(/^[a-f0-9]{64}$/),
      authorityId: idSchema,
      receivedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      expiresAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .refine(
      (receipt) =>
        receipt.expiresAtMs - receipt.receivedAtMs ===
        necessaryEvidencePolicy.maxAgeMs,
    ),
  ciphertext: bytes(necessaryEvidencePolicy.maxPayloadBytes),
  nonce: bytes(12, true),
  tag: bytes(16, true),
});
