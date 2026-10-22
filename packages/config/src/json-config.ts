import { z } from 'zod';

/** Explicit JSON environment policy. Absence is inert and malformed input never gets defaults. */
export const optionalJsonConfig = <Schema extends z.ZodType>(schema: Schema) =>
  z
    .string()
    .transform((value, ctx): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid JSON' });
        return z.NEVER;
      }
    })
    .pipe(schema)
    .optional();
