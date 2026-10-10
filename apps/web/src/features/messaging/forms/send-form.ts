import { createAppError } from '@daisy/errors';
import { parseMessagingFormScope, formRequestId } from './form-scope';

export type MessageFormState = {
  readonly text: string;
  readonly requestId: string;
  readonly notice?: string;
  readonly next?: string;
};

/** Bound arguments and native fields are both untrusted on action submission. */
export function parseMessageForm(channel: unknown, input: unknown) {
  const { form, channelId, requestId } = parseMessagingFormScope(
    channel,
    input,
  );
  const text = form.get('text');
  if (typeof text !== 'string' || form.getAll('text').length !== 1)
    throw createAppError('VALIDATION');
  return {
    version: 1 as const,
    channelId,
    requestId,
    text,
  };
}

export function messageFormUnavailable(form: FormData): MessageFormState {
  return {
    text: typeof form.get('text') === 'string' ? String(form.get('text')) : '',
    requestId: formRequestId(form),
    notice: 'Message could not be sent. Your draft is kept; try again.',
  };
}
