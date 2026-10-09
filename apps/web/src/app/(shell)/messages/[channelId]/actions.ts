'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { idSchema } from '@daisy/protocol';
import { processRoute } from '../../../../server/process-app';
import { inProcessFetch } from '../../../../server/in-process-fetch';
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
        notice:
          response.status === 429
            ? 'Please wait before sending again. Your draft is kept.'
            : response.status === 403 || response.status === 404
              ? 'You cannot send to this conversation now. Your draft is kept.'
              : kept.notice!,
      };
    const result: unknown = await response.json();
    const messageId = idSchema.safeParse(
      result !== null && typeof result === 'object' && 'id' in result
        ? result.id
        : null,
    );
    if (!messageId.success) return kept;
    const path = `/messages/${command.channelId}`;
    revalidatePath(path);
    next = `${path}?sent=${messageId.data}`;
  } catch {
    return kept;
  }
  return { text: '', requestId: command.requestId, ...moveOn(incoming, next) };
}
