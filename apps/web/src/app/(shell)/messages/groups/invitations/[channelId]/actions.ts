'use server';
import { headers } from 'next/headers';
import { messagingGroupInvitationResultSchema } from '@daisy/protocol';
import { processRoute } from '../../../../../../server/process-app';
import { inProcessFetch } from '../../../../../../server/in-process-fetch';
import { moveOn } from '../../../../../../server/form-action';
import { parseInvitationDecisionForm } from '../../../../../../features/messaging/forms/invitation-form';
import {
  dmDecisionUnavailable,
  type DmDecisionFormState,
} from '../../../../../../features/messaging/forms/decide-form';
const decide = processRoute((routes) => routes.messaging.decideGroupInvitation);
export async function decideInvitationAction(
  channelId: unknown,
  generation: unknown,
  _previous: DmDecisionFormState,
  form: FormData,
): Promise<DmDecisionFormState> {
  const incoming = new Headers(await headers()),
    kept = dmDecisionUnavailable(form);
  let next: string;
  try {
    const command = parseInvitationDecisionForm(channelId, generation, form);
    const response = await inProcessFetch(decide, incoming)(
      '/api/messaging/groups/invitations/decide',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok) return kept;
    const result = messagingGroupInvitationResultSchema.safeParse(
      await response.json(),
    );
    if (
      !result.success ||
      result.data.channelId !== command.channelId ||
      result.data.generation !== command.expectedGeneration ||
      result.data.state !==
        (command.decision === 'accept' ? 'accepted' : 'declined')
    )
      return kept;
    next =
      result.data.state === 'accepted'
        ? `/messages/${command.channelId}`
        : '/messages';
  } catch {
    return kept;
  }
  return { requestId: kept.requestId, ...moveOn(incoming, next) };
}
