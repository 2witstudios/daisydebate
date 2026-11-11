import { createAppError } from '@daisy/errors';
import type { Idle, Moved, Refused } from '../../forms/form-state';
import { parseMessagingFormScope, formRequestId } from './form-scope';

/** The request a decision posts under. */
type DecisionValues = { readonly values: { readonly requestId: string } };
export type DmDecisionRefused = Refused & DecisionValues;

/** A request or invitation decision's answer. */
export type DmDecisionFormState =
  (Idle & DecisionValues) | DmDecisionRefused | Moved;

export const dmDecisionIdle = (requestId: string): DmDecisionFormState => ({
  kind: 'idle',
  values: { requestId },
});

/** What a decision form renders. */
export type DmDecisionFields = {
  readonly requestId: string;
  readonly notice: string | undefined;
};

export function dmDecisionFields(
  answer: DmDecisionFormState,
): DmDecisionFields {
  switch (answer.kind) {
    case 'idle':
      return { requestId: answer.values.requestId, notice: undefined };
    case 'refused':
      return { requestId: answer.values.requestId, notice: answer.error };
    case 'moved':
      return { requestId: '', notice: undefined };
  }
}
export function parseDmDecisionForm(channel: unknown, input: unknown) {
  const { form, channelId, requestId } = parseMessagingFormScope(
    channel,
    input,
  );
  const decision = form.get('decision');
  if (
    form.getAll('decision').length !== 1 ||
    !['accept', 'decline', 'cancel'].includes(String(decision))
  )
    throw createAppError('VALIDATION');
  return {
    version: 1 as const,
    channelId,
    requestId,
    decision: decision as 'accept' | 'decline' | 'cancel',
  };
}
export const dmDecisionUnavailable = (form: FormData): DmDecisionRefused => ({
  kind: 'refused',
  values: { requestId: formRequestId(form) },
  error: 'This request could not be changed. Refresh or try again.',
});
