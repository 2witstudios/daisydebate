import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { Idle, Moved, Refused } from '../../forms/form-state';
import { formRequestId } from './form-scope';

/** Who a new conversation is with, and what a group or a request adds. */
type CreationValues = {
  readonly values: {
    readonly requestId: string;
    readonly recipients: string;
    readonly title: string;
    readonly introduction: string;
  };
};
export type CreationRefused = Refused & CreationValues;

/** A conversation-creation form's answer; a refusal keeps the draft. */
export type CreationFormState =
  (Idle & CreationValues) | CreationRefused | Moved;

export const creationIdle = (
  requestId: string,
  recipients = '',
): CreationFormState => ({
  kind: 'idle',
  values: { requestId, recipients, title: '', introduction: '' },
});

/** What a creation form renders: its draft and the refusal beside it. */
export type CreationFields = CreationValues['values'] & {
  readonly notice: string | undefined;
};

export function creationFields(answer: CreationFormState): CreationFields {
  switch (answer.kind) {
    case 'idle':
      return { ...answer.values, notice: undefined };
    case 'refused':
      return { ...answer.values, notice: answer.error };
    case 'moved':
      return {
        requestId: '',
        recipients: '',
        title: '',
        introduction: '',
        notice: undefined,
      };
  }
}
function field(form: FormData, name: string) {
  const value = form.get(name);
  if (typeof value !== 'string' || form.getAll(name).length !== 1)
    throw createAppError('VALIDATION');
  return value;
}
export function parseCreationForm(kind: unknown, input: unknown) {
  if (
    !(input instanceof FormData) ||
    !['dm', 'private_group'].includes(String(kind))
  )
    throw createAppError('VALIDATION');
  const parsed = idSchema.safeParse(field(input, 'requestId'));
  if (!parsed.success) throw createAppError('VALIDATION');
  const recipients = field(input, 'recipients');
  const base = { version: 1 as const, requestId: parsed.data };
  if (kind === 'private_group')
    return {
      ...base,
      title: field(input, 'title'),
      invitedUsernames: recipients.split(/[,\n]/).map((name) => name.trim()),
    };
  const introduction = field(input, 'introduction');
  return {
    ...base,
    recipientUsername: recipients,
    ...(introduction.trim() === '' ? {} : { introduction }),
  };
}
function kept(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
export function creationFormUnavailable(form: FormData): CreationRefused {
  return {
    kind: 'refused',
    values: {
      requestId: formRequestId(form),
      recipients: kept(form, 'recipients'),
      title: kept(form, 'title'),
      introduction: kept(form, 'introduction'),
    },
    error: 'Could not start this conversation. Your draft is kept; try again.',
  };
}
