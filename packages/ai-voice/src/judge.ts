import { createAppError } from '@daisy/errors';
import { ballotSchema, type Ballot } from '@daisy/protocol';
import { modelJson } from './model-json';

/**
 * The judge model's answer as a validated ballot — the one ballot contract
 * the human judging UI produces (ADR 0058 §6). Models sometimes wrap JSON
 * in a code fence; anything that still is not a valid ballot is an
 * infrastructure failure (the judge could not rule), never user input.
 */
export function parseBallot(answer: string): Ballot {
  const value = modelJson(answer, 'The judge answered malformed JSON');
  const result = ballotSchema.safeParse(value);
  if (!result.success)
    throw createAppError(
      'INFRASTRUCTURE',
      'The judge answered an invalid ballot',
      result.error,
    );
  return result.data;
}
