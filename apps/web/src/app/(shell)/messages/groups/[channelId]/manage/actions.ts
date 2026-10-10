'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { messagingGroupCreationResultSchema } from '@daisy/protocol';
import { processRoute } from '../../../../../../server/process-app';
import { inProcessFetch } from '../../../../../../server/in-process-fetch';
import { moveOn } from '../../../../../../server/form-action';
import {
  parseGroupManagementForm,
  groupManagementUnavailable,
  type GroupManagementFormState,
} from '../../../../../../features/messaging/forms/group-management-form';
const manage = processRoute((routes) => routes.messaging.manageGroup);
export async function manageGroupAction(
  channelId: unknown,
  operation: unknown,
  _previous: GroupManagementFormState,
  form: FormData,
): Promise<GroupManagementFormState> {
  const incoming = new Headers(await headers()),
    kept = groupManagementUnavailable(form);
  let next: string;
  try {
    const command = parseGroupManagementForm(operation, channelId, form);
    const response = await inProcessFetch(manage, incoming)(
      '/api/messaging/groups/manage',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok) return kept;
    const parsed = messagingGroupCreationResultSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success || parsed.data.channelId !== command.channelId)
      return kept;
    next =
      command.operation === 'leave'
        ? '/messages'
        : `/messages/${command.channelId}`;
    revalidatePath('/messages');
  } catch {
    return kept;
  }
  return { ...kept, notice: '', ...moveOn(incoming, next) };
}
