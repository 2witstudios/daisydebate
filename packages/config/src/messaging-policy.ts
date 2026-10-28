import { z } from 'zod';
import { optionalJsonConfig } from './json-config';
import { positiveIntegerSchema, rateWindowsSchema } from './rate-windows';

/**
 * DEC-251 overrides a deployment may set to tighten the beta messaging
 * policy. Only the shape is checked here; the web composition refuses any
 * value looser than the policy it tightens. Unknown keys are refused, and
 * absence keeps the policy as shipped.
 */
export const messagingPolicyConfig = optionalJsonConfig(
  z.strictObject({
    editWindowMs: positiveIntegerSchema.optional(),
    send: rateWindowsSchema.optional(),
    read: rateWindowsSchema.optional(),
    reactions: z
      .strictObject({
        windows: rateWindowsSchema.optional(),
        distinctPerMessage: positiveIntegerSchema.optional(),
      })
      .optional(),
    typing: rateWindowsSchema.optional(),
    fileUploadsDaily: positiveIntegerSchema.optional(),
  }),
);

export type MessagingPolicyOverride = NonNullable<
  z.output<typeof messagingPolicyConfig>
>;
