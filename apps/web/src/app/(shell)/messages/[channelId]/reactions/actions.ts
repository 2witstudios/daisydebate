'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { processRoute } from '../../../../../server/process-app';
import { submitMessagingForm } from '../../../../../server/messaging-form-submit';
import { moveOn } from '../../../../../server/form-action';
import { parseReactionForm } from '../../../../../features/messaging/forms/reaction-form';
import type { ReactionFormState } from '../../../../../ui/messaging/reaction-form';
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
      !(await submitMessagingForm(
        incoming,
        change,
        '/api/messaging/reactions',
        command,
        { field: 'messageId', value: command.messageId },
      ))
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
