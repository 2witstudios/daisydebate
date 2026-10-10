import { createAppError } from '@daisy/errors';
import { parseMessagingFormScope, formRequestId } from './form-scope';
export type GroupManagementFormState = {
  readonly requestId: string;
  readonly memberUsername: string;
  readonly notice?: string;
  readonly next?: string;
};
export function parseGroupManagementForm(
  operation: unknown,
  channel: unknown,
  input: unknown,
) {
  const scope = parseMessagingFormScope(channel, input);
  if (
    typeof operation !== 'string' ||
    !['invite', 'remove', 'transfer', 'leave', 'archive'].includes(operation)
  )
    throw createAppError('VALIDATION');
  const base = {
    version: 1 as const,
    channelId: scope.channelId,
    requestId: scope.requestId,
    operation,
  };
  if (operation === 'leave' || operation === 'archive') return base;
  const username = scope.form.get('memberUsername');
  if (
    typeof username !== 'string' ||
    scope.form.getAll('memberUsername').length !== 1
  )
    throw createAppError('VALIDATION');
  if (operation === 'invite')
    return {
      version: base.version,
      channelId: base.channelId,
      requestId: base.requestId,
      invitedUsernames: [username],
    };
  return { ...base, memberUsername: username };
}
export function groupManagementUnavailable(
  form: FormData,
): GroupManagementFormState {
  const value = form.get('memberUsername');
  return {
    requestId: formRequestId(form),
    memberUsername: typeof value === 'string' ? value : '',
    notice: 'Could not complete this change. Your entry is kept; try again.',
  };
}
