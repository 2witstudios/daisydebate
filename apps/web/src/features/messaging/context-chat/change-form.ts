import {
  createMessagingCoreSchemas,
  contentReportCreateSchema,
  idSchema,
  messagingBetaLimits,
} from '@daisy/protocol';
import { messageDraft, messageUnsentNotice } from '../forms/send-form';
import type { ChatContext } from './chat-context';
import {
  contextChatChanged,
  contextChatCommand,
  contextChatRefused,
  contextChatSent,
  contextChatUnacknowledged,
  sameContextChatCommand,
  unacknowledgedContextChatCommand,
  type ContextChatFormState,
} from './form-state';
const schemas = createMessagingCoreSchemas(messagingBetaLimits);
/** A retry repeats the full original command, including its target and operation. */
export async function submitContextChatChange(
  context: ChatContext,
  send: (kind: string, url: string, init: RequestInit) => Promise<Response>,
  scope: { readonly ownerId: string; readonly channelId: string },
  previous: unknown,
  form: FormData,
  nextId: () => string,
  report = false,
): Promise<ContextChatFormState> {
  const posted = contextChatCommand(form);
  const original = unacknowledgedContextChatCommand(previous);
  if (original !== null && !sameContextChatCommand(original, posted))
    return contextChatUnacknowledged(
      original,
      'Retry the original change before starting another one.',
    );
  const lost = contextChatUnacknowledged(posted, messageUnsentNotice);
  // Once unacknowledged, only a confirmed answer releases the command.
  const refuse = (
    error: string,
    mayHaveCommitted = false,
  ): ContextChatFormState =>
    original !== null || mayHaveCommitted
      ? contextChatUnacknowledged(posted, error)
      : contextChatRefused(messageDraft(form), error);
  let command: unknown, kind: string, messageId: string;
  try {
    idSchema.parse(scope.ownerId);
    messageId = idSchema.parse(form.get('messageId'));
    kind = report ? 'report' : String(form.get('kind'));
    const base = {
      version: 1 as const,
      channelId: idSchema.parse(scope.channelId),
      messageId,
      requestId: idSchema.parse(form.get('requestId')),
    };
    if (report) {
      const value = contentReportCreateSchema.parse({
        targetKind: 'chat_message',
        targetId: messageId,
        reason: form.get('reason'),
      });
      command = {
        version: 1,
        channelId: base.channelId,
        messageId,
        reason: value.reason,
      };
    } else if (kind === 'edit')
      command = schemas.edit.parse({ ...base, text: form.get('text') });
    else if (kind === 'remove') command = schemas.remove.parse(base);
    else return refuse(messageUnsentNotice);
  } catch {
    return refuse(messageUnsentNotice);
  }
  try {
    const response = await send(
      kind,
      `${context.address(scope.ownerId)}/${kind}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok)
      return refuse(
        response.status === 429
          ? 'Please wait before trying again.'
          : 'This change was not accepted. Your text is kept.',
        response.status >= 500,
      );
    const result: unknown = await response.json();
    if (report)
      return result &&
        typeof result === 'object' &&
        'received' in result &&
        result.received === true
        ? contextChatSent(messageId, idSchema.parse(nextId()))
        : lost;
    const parsed = schemas.messageResult.safeParse(result);
    if (
      !parsed.success ||
      parsed.data.id !== messageId ||
      parsed.data.channelId !== scope.channelId
    )
      return lost;
    const removed = 'unavailable' in parsed.data;
    if (removed !== (kind === 'remove')) return lost;
    return contextChatChanged(
      messageId,
      idSchema.parse(nextId()),
      'unavailable' in parsed.data ? '' : parsed.data.text,
      parsed.data.changeVersion,
    );
  } catch {
    return lost;
  }
}
