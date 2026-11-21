import { z } from 'zod';
import { secret } from './secrets';

export const analyticsFields = {
  NEXT_PUBLIC_POSTHOG_KEY: z
    .string()
    .regex(/^phc_[A-Za-z0-9_-]+$/)
    .optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z
    .enum(['https://us.i.posthog.com', 'https://eu.i.posthog.com'])
    .optional(),
  POSTHOG_API_KEY: secret(z.string().regex(/^phc_[A-Za-z0-9_-]+$/)).optional(),
  POSTHOG_PERSONAL_API_KEY: secret(
    z.string().regex(/^phx_[A-Za-z0-9_-]+$/),
  ).optional(),
  POSTHOG_PROJECT_ID: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
};
