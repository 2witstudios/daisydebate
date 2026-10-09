import { createAppError } from '@daisy/errors';
import { parseMessagingFormScope, formRequestId } from './form-scope';
export type DmDecisionFormState = {
  readonly requestId: string;
  readonly notice?: string;
  readonly next?: string;
};
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
export const dmDecisionUnavailable = (form: FormData): DmDecisionFormState => ({
  requestId: formRequestId(form),
  notice: 'This request could not be changed. Refresh or try again.',
});
