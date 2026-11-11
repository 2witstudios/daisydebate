import { createAppError } from '@daisy/errors';
import { type Idle, type Moved, type Refused } from '../../forms/form-state';
import { parseMessagingFormScope, formRequestId } from './form-scope';

/** The command a message form posts: its text under one request id. */
type MessageValues = {
  readonly values: { readonly text: string; readonly requestId: string };
};
export type MessageRefused = Refused & MessageValues;

/** A message form's answer; a refusal keeps the draft and the request it was posted under. */
export type MessageFormState = (Idle & MessageValues) | MessageRefused | Moved;

export const messageIdle = (
  requestId: string,
  text = '',
): MessageFormState => ({
  kind: 'idle',
  values: { text, requestId },
});

export const messageRefused = (
  values: MessageValues['values'],
  error: string,
): MessageRefused => ({ kind: 'refused', values, error });

/** What a message form renders: its draft, its request and the refusal beside them. */
export type MessageFields = {
  readonly text: string;
  readonly requestId: string;
  readonly notice: string | undefined;
};

export function messageFields(answer: MessageFormState): MessageFields {
  switch (answer.kind) {
    case 'idle':
      return { ...answer.values, notice: undefined };
    case 'refused':
      return { ...answer.values, notice: answer.error };
    case 'moved':
      return { text: '', requestId: '', notice: undefined };
  }
}

/** The draft and request a posted message form carried, whatever else it held. */
export const messageDraft = (form: FormData): MessageValues['values'] => ({
  text: typeof form.get('text') === 'string' ? String(form.get('text')) : '',
  requestId: formRequestId(form),
});

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

export const messageUnsentNotice =
  'Message could not be sent. Your draft is kept; try again.';

export const messageFormUnavailable = (form: FormData): MessageRefused =>
  messageRefused(messageDraft(form), messageUnsentNotice);
