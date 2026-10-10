import { createAppError } from '@daisy/errors';
import { parseDmDecisionForm } from './decide-form';
/** Bind the exact server preview generation; a stale form never targets a renewed invitation. */
export function parseInvitationDecisionForm(
  channel: unknown,
  generation: unknown,
  input: unknown,
) {
  const command = parseDmDecisionForm(channel, input);
  if (
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation <= 0 ||
    command.decision === 'cancel'
  )
    throw createAppError('VALIDATION');
  return { ...command, expectedGeneration: generation };
}
