import { z } from 'zod';
import { optionalJsonConfig } from './json-config';

const positiveInteger = z.number().int().positive().safe();
const windows = z
  .array(
    z.strictObject({ max: positiveInteger, windowSeconds: positiveInteger }),
  )
  .nonempty()
  .max(4)
  .refine(
    (rules) =>
      new Set(rules.map((rule) => rule.windowSeconds)).size === rules.length,
    { message: 'Each window needs its own length' },
  );

/**
 * DEC-251 overrides a deployment may set to tighten the beta messaging
 * policy. Only the shape is checked here; the web composition refuses any
 * value looser than the policy it tightens. Unknown keys are refused, and
 * absence keeps the policy as shipped.
 */
export const messagingPolicyConfig = optionalJsonConfig(
  z.strictObject({
    editWindowMs: positiveInteger.optional(),
    send: windows.optional(),
    read: windows.optional(),
    reactions: z
      .strictObject({
        windows: windows.optional(),
        distinctPerMessage: positiveInteger.optional(),
      })
      .optional(),
    typing: windows.optional(),
    socialRequests: z
      .strictObject({
        daily: positiveInteger.optional(),
        unrelatedHourly: positiveInteger.optional(),
        declinesToBlock: positiveInteger.optional(),
        declineBlockMs: positiveInteger.optional(),
      })
      .optional(),
    fileUploadsDaily: positiveInteger.optional(),
  }),
);

export type MessagingPolicyOverride = NonNullable<
  z.output<typeof messagingPolicyConfig>
>;
