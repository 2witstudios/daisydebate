'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  messagingDmResultSchema,
  messagingGroupCreationResultSchema,
} from '@daisy/protocol';
import { processRoute } from '../../../../server/process-app';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { moveOn } from '../../../../server/form-action';
import {
  parseCreationForm,
  creationFormUnavailable,
  type CreationFormState,
} from '../../../../features/messaging/forms/create-form';
const requestDm = processRoute((routes) => routes.messaging.requestByUsername);
const createGroup = processRoute(
  (routes) => routes.messaging.createGroupByUsername,
);
export async function createConversationAction(
  kind: 'dm' | 'private_group',
  _previous: CreationFormState,
  form: FormData,
): Promise<CreationFormState> {
  const incoming = new Headers(await headers());
  const kept = creationFormUnavailable(form);
  let next: string;
  try {
    const command = parseCreationForm(kind, form);
    const response = await inProcessFetch(
      kind === 'dm' ? requestDm : createGroup,
      incoming,
    )(
      kind === 'dm'
        ? '/api/messaging/requests/username'
        : '/api/messaging/groups/username',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok) return kept;
    const schema =
      kind === 'dm'
        ? messagingDmResultSchema
        : messagingGroupCreationResultSchema;
    const result = schema.safeParse(await response.json());
    if (!result.success) return kept;
    next =
      'state' in result.data && result.data.state === 'pending'
        ? `/messages/requests/${result.data.channelId}/status`
        : `/messages/${result.data.channelId}`;
    revalidatePath('/messages');
  } catch {
    return kept;
  }
  return { ...kept, notice: '', ...moveOn(incoming, next) };
}
