import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { formRequestId } from './form-scope';
export type BlockFormState = {
  readonly requestId: string;
  readonly username: string;
  readonly notice?: string;
};
export function parseBlockForm(input: unknown) {
  if (!(input instanceof FormData)) throw createAppError('VALIDATION');
  const read = (key: string) => {
    const value = input.get(key);
    if (typeof value !== 'string' || input.getAll(key).length !== 1)
      throw createAppError('VALIDATION');
    return value;
  };
  const requestId = idSchema.safeParse(read('requestId'));
  const decision = read('decision');
  if (!requestId.success || !['block', 'unblock'].includes(decision))
    throw createAppError('VALIDATION');
  return {
    version: 1 as const,
    requestId: requestId.data,
    recipientUsername: read('username'),
    blocked: decision === 'block',
  };
}
export function blockFormUnavailable(input: FormData): BlockFormState {
  const username = input.get('username');
  return {
    requestId: formRequestId(input),
    username: typeof username === 'string' ? username : '',
    notice: 'Could not change this contact. Your username is kept; try again.',
  };
}
