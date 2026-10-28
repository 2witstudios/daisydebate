import { z } from 'zod';

/** A positive safe integer, the shape of every policy count and length. */
export const positiveIntegerSchema = z.number().int().positive().safe();

/** A policy override's rate windows: up to four, each its own length. */
export const rateWindowsSchema = z
  .array(
    z.strictObject({
      max: positiveIntegerSchema,
      windowSeconds: positiveIntegerSchema,
    }),
  )
  .nonempty()
  .max(4)
  .refine(
    (rules) =>
      new Set(rules.map((rule) => rule.windowSeconds)).size === rules.length,
    { message: 'Each window needs its own length' },
  );
