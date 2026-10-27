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
import { moveOn } from '../../../../server/form-action';
import {
  formReadThrough,
  markReadDestination,
  messagingMarkReadBody,
} from '../../../../features/messaging/mark-read';
import {
  parseMessageForm,
  messageFormUnavailable,
  type MessageFormState,
} from '../../../../features/messaging/forms/send-form';

const send = processRoute((routes) => routes.messaging.send);
const markRead = processRoute((routes) => routes.messaging.markRead);

/**
 * ISSUE-606: marks a conversation read through `sequence` by native POST,
 * never on a GET, answering whether the route accepted it. A refusal
 * leaves it unread.
 */
async function markReadThrough(
  incoming: Headers,
  channelId: string,
  sequence: number | null,
): Promise<boolean> {
  if (sequence === null) return false;
  try {
    const response = await inProcessFetch(markRead, incoming)(
      '/api/messaging/read',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(messagingMarkReadBody(channelId, sequence)),
      },
    );
    return response.ok;
  } catch {
    // The next visit with JavaScript, or the next native post, marks it.
    return false;
  }
}

/**
 * The no-JS "Mark as read" button: marks it, then returns to the page, with
 * a fixed notice when the route refused.
 */
export async function markReadAction(
  channelId: string,
  sequence: number,
): Promise<void> {
  const incoming = new Headers(await headers());
  const id = idSchema.parse(channelId);
  const marked = await markReadThrough(incoming, id, sequence);
  revalidatePath('/messages');
  moveOn(incoming, markReadDestination(id, marked));
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
  let command: ReturnType<typeof parseMessageForm>;
  let next: string;
  try {
    command = parseMessageForm(channelId, form);
    const response = await inProcessFetch(send, incoming)(
      '/api/messaging/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok)
      return {
        ...kept,
        notice: notices[response.status] ?? kept.notice!,
      };
    const result: unknown = await response.json();
    const reply = z.object({ id: idSchema }).safeParse(result);
    if (!reply.success) return kept;
    await markReadThrough(incoming, command.channelId, formReadThrough(form));
    const path = `/messages/${command.channelId}`;
    revalidatePath(path);
    next = `${path}?sent=${reply.data.id}`;
  } catch {
    return kept;
  }
  return { text: '', requestId: command.requestId, ...moveOn(incoming, next) };
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
  return { text: '', requestId: kept.requestId, ...moveOn(incoming, path) };
}
