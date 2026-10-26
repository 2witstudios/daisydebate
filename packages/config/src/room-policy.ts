import { z } from 'zod';
import { optionalJsonConfig } from './json-config';

const positiveInteger = z.number().int().positive();
const rate = z.strictObject({
  max: positiveInteger,
  windowSeconds: positiveInteger,
});
const policy = z.strictObject({
  consentTtlMs: positiveInteger,
  /**
   * Milliseconds an open Room may go without a command (or running prep)
   * before maintenance closes it (ADR 0069). No default: absent keeps idle
   * expiry inert while the rest of the policy applies.
   */
  idleTimeoutMs: positiveInteger.optional(),
  maxBodyBytes: positiveInteger,
  limits: z.strictObject({ create: rate, read: rate, command: rate }),
});

/** Explicit deployment policy; absence is inert, never filled with proof values. */
export const roomPolicyConfig = optionalJsonConfig(policy);
