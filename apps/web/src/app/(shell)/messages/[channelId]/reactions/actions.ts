'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { processRoute } from '../../../../../server/process-app';
import { submitMessagingForm } from '../../../../../server/messaging-form-submit';
import { moveOn, stayOn } from '../../../../../server/form-action';
import { parseReactionForm } from '../../../../../features/messaging/forms/reaction-form';
import { systemId } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import type { ReactionFormState } from '../../../../../ui/messaging/reaction-form';
import type { ReactionPillState } from '../../../../../ui/messaging/reaction-pill';
const change = processRoute((routes) => routes.messaging.reactions);
export async function changeReactionAction(
  channelId: string,
  messageId: string,
  _previous: ReactionFormState,
  form: FormData,
): Promise<ReactionFormState> {
  const incoming = new Headers(await headers());
  const kept = {
    requestId: String(form.get('requestId') ?? ''),
    notice: 'Reaction could not be changed. Try again.',
  };
  try {
    const command = parseReactionForm(channelId, messageId, form);
    if (
      (await submitMessagingForm(
        incoming,
        change,
        '/api/messaging/reactions',
        command,
        { field: 'messageId', value: command.messageId },
      )) !== 'accepted'
    )
      return kept;
  } catch {
    return kept;
  }
  const path = `/messages/${channelId}/reactions?messageId=${messageId}`;
  revalidatePath(`/messages/${channelId}`);
  revalidatePath(`/messages/${channelId}/reactions`);
  return { requestId: kept.requestId, ...moveOn(incoming, path) };
}

/**
 * A pill's toggle in the conversation. Its fields are untrusted and the route
 * re-validates them. The desired state is in the form, so a repeat is harmless
 * and each post takes a fresh request. Hydrated, the answer updates the reader's
 * own mark and the count arrives by snapshot, so nothing refetches the page.
 */
export async function reactToMessageAction(
  _previous: ReactionPillState,
  form: FormData,
): Promise<ReactionPillState> {
  const incoming = new Headers(await headers());
  const refused = { notice: 'Reaction could not be changed. Try again.' };
  const channel = idSchema.safeParse(form.get('channelId'));
  const message = idSchema.safeParse(form.get('messageId'));
  if (!channel.success || !message.success) return refused;
  form.set('requestId', systemId.next());
  try {
    const command = parseReactionForm(channel.data, message.data, form);
    if (
      (await submitMessagingForm(
        incoming,
        change,
        '/api/messaging/reactions',
        command,
        { field: 'messageId', value: command.messageId },
      )) !== 'accepted'
    )
      return refused;
  } catch {
    return refused;
  }
  return {
    own: form.get('active') === 'true',
    ...stayOn(incoming, `/messages/${channel.data}`),
  };
}
