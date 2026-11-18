import { z } from 'zod';

/**
 * The deployment's default for release flags with no stored choice
 * (ADR 0118 amendment). Unset, each release flag keeps its catalogue safe
 * default (off). Exactly `enabled` turns them on, and only staging may set it.
 */
export const releaseFlagDefaultFields = {
  DAISY_RELEASE_FLAG_DEFAULT: z.literal('enabled').optional(),
};

type ReleaseFlagDefaultConfig = {
  readonly NODE_ENV: string;
  readonly OPERATOR_AUDIENCE?: string | undefined;
  readonly DAISY_RELEASE_FLAG_DEFAULT?: 'enabled' | undefined;
};

/**
 * Staging and production both run NODE_ENV=production, so a production-mode
 * process must also name itself staging (its committed operator audience,
 * `daisy-web:staging`). Anything else, production included, refuses to start.
 */
export function refineReleaseFlagDefault(
  config: ReleaseFlagDefaultConfig,
  ctx: z.RefinementCtx,
) {
  if (
    config.DAISY_RELEASE_FLAG_DEFAULT !== undefined &&
    config.NODE_ENV === 'production' &&
    config.OPERATOR_AUDIENCE !== 'daisy-web:staging'
  )
    ctx.addIssue({
      code: 'custom',
      path: ['DAISY_RELEASE_FLAG_DEFAULT'],
      message: 'The release flag default is staging-only',
    });
}
