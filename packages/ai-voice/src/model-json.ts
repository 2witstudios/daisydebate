import { createAppError } from '@daisy/errors';

/**
 * A model's JSON answer, without the code fence models sometimes add. An
 * answer that still is not JSON is an infrastructure failure, never input.
 */
export function modelJson(answer: string, malformed: string): unknown {
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
