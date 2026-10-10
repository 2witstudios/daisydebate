import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { formRequestId } from './form-scope';
export type CreationFormState = {
  readonly requestId: string;
  readonly recipients: string;
  readonly title: string;
  readonly introduction: string;
  readonly notice?: string;
  readonly next?: string;
};
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
export function creationFormUnavailable(form: FormData): CreationFormState {
  return {
    requestId: formRequestId(form),
    recipients: kept(form, 'recipients'),
    title: kept(form, 'title'),
    introduction: kept(form, 'introduction'),
    notice: 'Could not start this conversation. Your draft is kept; try again.',
  };
}
