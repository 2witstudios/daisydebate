import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

export type MessageFormState = {
  readonly text: string;
  readonly requestId: string;
  readonly notice?: string;
  readonly next?: string;
};

/** Bound arguments and native fields are both untrusted on action submission. */
export function parseMessageForm(channel: unknown, input: unknown) {
  if (!(input instanceof FormData)) throw createAppError('VALIDATION');
  const channelId = idSchema.safeParse(channel);
  const requestId = idSchema.safeParse(input.get('requestId'));
  const text = input.get('text');
  if (
    !channelId.success ||
    !requestId.success ||
    typeof text !== 'string' ||
    input.getAll('requestId').length !== 1 ||
    input.getAll('text').length !== 1
  )
    throw createAppError('VALIDATION');
  return {
    version: 1 as const,
    channelId: channelId.data,
    requestId: requestId.data,
    text,
  };
}

export function messageFormUnavailable(form: FormData): MessageFormState {
  return {
    text: typeof form.get('text') === 'string' ? String(form.get('text')) : '',
    requestId:
      typeof form.get('requestId') === 'string'
        ? String(form.get('requestId'))
        : '',
    notice: 'Message could not be sent. Your draft is kept; try again.',
  };
}
