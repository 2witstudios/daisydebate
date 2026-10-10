import { z } from 'zod';

const positiveInteger = z.number().int().positive();
const rate = z.strictObject({
  max: positiveInteger,
  windowSeconds: positiveInteger,
});
const policy = z.strictObject({
  consentTtlMs: positiveInteger,
  maxOpenRooms: positiveInteger,
  maxBodyBytes: positiveInteger,
  limits: z.strictObject({ create: rate, read: rate, command: rate }),
});

/** Explicit deployment policy; absence is inert, never filled with proof values. */
export const roomPolicyConfig = z
  .string()
  .transform((value, ctx): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid JSON' });
      return z.NEVER;
    }
  })
  .pipe(policy)
  .optional();
