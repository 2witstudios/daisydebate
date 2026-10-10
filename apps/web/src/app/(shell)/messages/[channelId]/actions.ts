'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { processRoute } from '../../../../server/process-app';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { submitMessagingForm } from '../../../../server/messaging-form-submit';
import {
  parseMessageMutationForm,
  messageMutationUnavailable,
} from '../../../../features/messaging/forms/message-mutation-form';
import { moveOn } from '../../../../server/form-action';
import {
  parseMessageForm,
  messageFormUnavailable,
  type MessageFormState,
} from '../../../../features/messaging/forms/send-form';

const send = processRoute((routes) => routes.messaging.send);
export async function sendMessageAction(
  channelId: unknown,
  _previous: MessageFormState,
  form: FormData,
): Promise<MessageFormState> {
  const kept = messageFormUnavailable(form);
  const incoming = new Headers(await headers());
  const notices: Readonly<Record<number, string>> = {
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
    if (
      !(await submitMessagingForm(
        incoming,
        operation === 'edit' ? edit : remove,
        `/api/messaging/messages/${operation}`,
        command,
        { field: 'id', value: command.messageId },
      ))
    )
      return kept;
  } catch {
    return kept;
  }
  const path = `/messages/${channelId}`;
  revalidatePath(path);
  return { text: '', requestId: kept.requestId, ...moveOn(incoming, path) };
}
