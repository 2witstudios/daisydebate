import { createAppError } from '@daisy/errors';
import { z } from 'zod';

const text = z.string().trim().min(1).max(2000);

export const ballotSchema = z.object({
  winner: z.enum(['affirmative', 'negative']),
  reason: text,
  speeches: z
    .array(
      z.object({
        turn: z.string().max(8),
        side: z.enum(['affirmative', 'negative']),
        strengths: text,
        improvements: text,
      }),
    )
    .max(10),
  tips: z.array(text).max(6),
});

export type Ballot = z.infer<typeof ballotSchema>;

/**
 * The judge model's answer as a validated ballot. Models sometimes wrap
 * JSON in a code fence; anything that still is not a valid ballot is an
 * infrastructure failure (the judge could not rule), never user input.
 */
export function parseBallot(answer: string): Ballot {
  const unfenced = answer
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(unfenced);
  } catch (cause) {
    throw createAppError(
      'INFRASTRUCTURE',
      'The judge answered malformed JSON',
      cause,
    );
  }
  const result = ballotSchema.safeParse(value);
  if (!result.success)
    throw createAppError(
      'INFRASTRUCTURE',
      'The judge answered an invalid ballot',
      result.error,
    );
  return result.data;
}
