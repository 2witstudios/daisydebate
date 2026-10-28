import { z } from 'zod';

/** The caller's own choice to hide their online status (ADR 0072). */
export const presenceSettingSchema = z.strictObject({
  version: z.literal(1),
  hidden: z.boolean(),
});

export const presenceSettingResultSchema = z.strictObject({
  version: z.literal(1),
  hidden: z.boolean(),
});
