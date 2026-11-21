'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { systemId } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import { processRoute } from '../../../../server/process-app';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { submitMessagingForm } from '../../../../server/messaging-form-submit';
import {
  parseMessageMutationForm,
  messageMutationConflict,
  messageMutationUnavailable,
} from '../../../../features/messaging/forms/message-mutation-form';
import { hydratedPost, moveOn } from '../../../../server/form-action';
import {
  formReadThrough,
  messagingMarkReadBody,
} from '../../../../features/messaging/mark-read';
import {
  parseMessageForm,
  messageFormUnavailable,
  messageRefused,
  type MessageFormState,
} from '../../../../features/messaging/forms/send-form';

const send = processRoute((routes) => routes.messaging.send);
const markRead = processRoute((routes) => routes.messaging.markRead);

/**
 * ISSUE-606: marks a conversation read through `sequence` by POST, never on a
 * GET, answering whether the route accepted it for this channel. A refusal
 * leaves it unread.
 */
async function markReadThrough(
  incoming: Headers,
  channelId: string,
  sequence: number | null,
): Promise<boolean> {
  if (sequence === null) return false;
  try {
    return (
      (await submitMessagingForm(
        incoming,
        markRead,
        '/api/messaging/read',
        messagingMarkReadBody(channelId, sequence),
        { field: 'channelId', value: channelId },
      )) === 'accepted'
    );
  } catch {
    // The live history, or the next post, marks it.
    return false;
  }
}

export async function sendMessageAction(
  channelId: unknown,
  _previous: MessageFormState,
  form: FormData,
): Promise<MessageFormState> {
  const kept = messageFormUnavailable(form);
  const incoming = new Headers(await headers());
  const notices: Readonly<Record<number, string>> = {
    400: 'Your message needs text and must fit the character limit. Your draft is kept.',
    429: 'Please wait before sending again. Your draft is kept.',
    403: 'You cannot send to this conversation now. Your draft is kept.',
    404: 'You cannot send to this conversation now. Your draft is kept.',
  };
  let next: string;
  try {
    const command = parseMessageForm(channelId, form);
    const response = await inProcessFetch(send, incoming)(
      '/api/messaging/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok)
      return messageRefused(
        kept.values,
        notices[response.status] ?? kept.error,
      );
    const result: unknown = await response.json();
    const reply = z.object({ id: idSchema }).safeParse(result);
    if (!reply.success) return kept;
    await markReadThrough(incoming, command.channelId, formReadThrough(form));
    const path = `/messages/${command.channelId}`;
    // A hydrated caller follows the receipt to a fresh page. An inline
    // re-render can unmount its composer before it handles that receipt.
    if (!hydratedPost(incoming)) revalidatePath(path);
    next = `${path}?sent=${reply.data.id}`;
  } catch {
    return kept;
  }
  return moveOn(incoming, next);
}

const edit = processRoute((routes) => routes.messaging.edit);
const remove = processRoute((routes) => routes.messaging.remove);
export async function changeMessageAction(
  channelId: string,
  messageId: string,
  _previous: MessageFormState,
  form: FormData,
): Promise<MessageFormState> {
  const kept = messageMutationUnavailable(form),
    incoming = new Headers(await headers());
  try {
    const { operation, command } = parseMessageMutationForm(
      channelId,
      messageId,
      form,
    );
    const outcome = await submitMessagingForm(
      incoming,
      operation === 'edit' ? edit : remove,
      `/api/messaging/messages/${operation}`,
      command,
      { field: 'id', value: command.messageId },
    );
    if (outcome === 'conflict')
      return messageMutationConflict(form, systemId.next());
    if (outcome === 'refused') return kept;
  } catch {
    return kept;
  }
  const path = `/messages/${channelId}`;
  return moveOn(incoming, path);
}
