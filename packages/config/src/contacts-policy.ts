import { z } from 'zod';
import { optionalJsonConfig } from './json-config';
import { rateWindowsSchema } from './rate-windows';

const positiveInteger = z.number().int().positive().safe();

/**
 * DEC-251 overrides a deployment may set to tighten the budgets Contacts
 * owns: the social request budget (DM and friend requests alike) and the
 * windows a member's blocks spend. Only the shape is
 * checked here; the web composition refuses any looser value. Unknown keys
 * are refused, and absence keeps the policy as shipped.
 */
export const contactsPolicyConfig = optionalJsonConfig(
  z.strictObject({
    requests: z
      .strictObject({
        daily: positiveInteger.optional(),
        unrelatedHourly: positiveInteger.optional(),
        declinesToBlock: positiveInteger.optional(),
        declineBlockMs: positiveInteger.optional(),
      })
      .optional(),
    blocks: rateWindowsSchema.optional(),
  }),
);

export type ContactsPolicyOverride = NonNullable<
  z.output<typeof contactsPolicyConfig>
>;
