import { createAppError } from '@daisy/errors';
import type { Idle, Moved, Refused } from '../../forms/form-state';
import { parseMessagingFormScope, formRequestId } from './form-scope';

/** The request a group change posts under and the member it names, if any. */
type GroupManagementValues = {
  readonly values: {
    readonly requestId: string;
    readonly memberUsername: string;
  };
};
export type GroupManagementRefused = Refused & GroupManagementValues;

/** A group-management form's answer; a refusal keeps the member typed. */
export type GroupManagementFormState =
  (Idle & GroupManagementValues) | GroupManagementRefused | Moved;

export const groupManagementIdle = (
  requestId: string,
): GroupManagementFormState => ({
  kind: 'idle',
  values: { requestId, memberUsername: '' },
});

/** What a group-management form renders. */
export type GroupManagementFields = GroupManagementValues['values'] & {
  readonly notice: string | undefined;
};

export function groupManagementFields(
  answer: GroupManagementFormState,
): GroupManagementFields {
  switch (answer.kind) {
    case 'idle':
      return { ...answer.values, notice: undefined };
    case 'refused':
      return { ...answer.values, notice: answer.error };
    case 'moved':
      return { requestId: '', memberUsername: '', notice: undefined };
  }
}
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
): GroupManagementRefused {
  const value = form.get('memberUsername');
  return {
    kind: 'refused',
    values: {
      requestId: formRequestId(form),
      memberUsername: typeof value === 'string' ? value : '',
    },
    error: 'Could not complete this change. Your entry is kept; try again.',
  };
}
