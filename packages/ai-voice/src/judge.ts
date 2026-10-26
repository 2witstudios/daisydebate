import { createAppError } from '@daisy/errors';
import { ballotLimits, ballotSchema, type Ballot } from '@daisy/protocol';
import { z } from 'zod';

/**
 * The judge model's answer as a validated ballot — the one ballot contract
 * the human judging UI produces (ADR 0058 §6). Models sometimes wrap JSON
 * in a code fence; anything that still is not a valid ballot is an
 * infrastructure failure (the judge could not rule), never user input.
 */
export function parseBallot(answer: string): Ballot {
  const value = unfencedJson(answer, 'The judge answered malformed JSON');
  const result = ballotSchema.safeParse(value);
  if (!result.success)
    throw createAppError(
      'INFRASTRUCTURE',
      'The judge answered an invalid ballot',
      result.error,
    );
  return result.data;
}

function unfencedJson(answer: string, malformed: string): unknown {
  const unfenced = answer
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch (cause) {
    throw createAppError('INFRASTRUCTURE', malformed, cause);
  }
}

const coachingText = z.string().trim().min(1).max(ballotLimits.feedback);
const coachingSchema = z.object({
  affirmative: coachingText,
  negative: coachingText,
});

/**
 * The coach model's answer (ADR 0071): coaching for both sides, each within
 * the ballot's feedback limit. Anything else is an infrastructure failure.
 */
export function parseCoaching(answer: string): {
  readonly affirmative: string;
  readonly negative: string;
} {
  const value = unfencedJson(answer, 'The coach answered malformed JSON');
  const result = coachingSchema.safeParse(value);
  if (!result.success)
    throw createAppError(
      'INFRASTRUCTURE',
      'The coach answered invalid coaching',
      result.error,
    );
  return {
    affirmative: result.data.affirmative,
    negative: result.data.negative,
  };
}
