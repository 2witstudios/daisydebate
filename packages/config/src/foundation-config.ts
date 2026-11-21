import { z } from 'zod';

export const foundationFields = {
  FOUNDATION_PROOF_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
};

export function requireFoundationProofDisabled(
  config: z.output<z.ZodObject<typeof foundationFields>>,
  ctx: z.RefinementCtx,
) {
  if (config.FOUNDATION_PROOF_ENABLED)
    ctx.addIssue({
      code: 'custom',
      path: ['FOUNDATION_PROOF_ENABLED'],
      message: 'Foundation proof is development-only',
    });
}
