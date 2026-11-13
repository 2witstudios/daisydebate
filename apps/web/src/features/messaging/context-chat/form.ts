import {
  createMessagingCoreSchemas,
  idSchema,
  messagingBetaLimits,
} from '@daisy/protocol';
import type { ChatContext } from './chat-context';
import {
  messageDraft,
  messageUnsentNotice,
  parseMessageForm,
} from '../forms/send-form';
import {
  contextChatCommand,
  contextChatRefused,
  contextChatSent,
  contextChatUnacknowledged,
  sameContextChatCommand,
  unacknowledgedContextChatCommand,
  type ContextChatFormState,
  type ContextChatUnacknowledged,
} from './form-state';

/** A lost answer may already have committed: keep the original command retryable. */
export const contextChatFormUnavailable = (
  form: FormData,
): ContextChatUnacknowledged =>
  contextChatUnacknowledged(contextChatCommand(form), messageUnsentNotice);

const notices = (name: string): Readonly<Record<number, string>> => ({
  400: 'Your message needs text and must fit the character limit. Your draft is kept.',
  403: `You cannot send to this ${name} now. Your draft is kept.`,
  404: `This ${name} is unavailable. Your draft is kept.`,
  409: 'This command conflicts with an earlier message. Your draft is kept.',
  429: 'Please wait before sending again. Your draft is kept.',
});
const schemas = createMessagingCoreSchemas(messagingBetaLimits);

/** Embedded forms use the canonical HTTP gates and never navigate away from the page they are on. */
export async function submitContextChatMessage(
  context: ChatContext,
  send: (url: string, init: RequestInit) => Promise<Response>,
  scope: { readonly ownerId: string; readonly channelId: string },
  previous: unknown,
  form: FormData,
  nextId: () => string,
): Promise<ContextChatFormState> {
  const original = unacknowledgedContextChatCommand(previous);
  if (
    original !== null &&
    !sameContextChatCommand(original, contextChatCommand(form))
  )
    return contextChatUnacknowledged(
      original,
      'Retry the original message before starting another one. Your draft is kept.',
    );
  // Once unacknowledged, only a confirmed answer releases the command.
  const refuse = (
    error: string,
    mayHaveCommitted = false,
  ): ContextChatFormState =>
    original !== null || mayHaveCommitted
      ? contextChatUnacknowledged(contextChatCommand(form), error)
      : contextChatRefused(messageDraft(form), error);
  let command: ReturnType<typeof parseMessageForm>;
  try {
    idSchema.parse(scope.ownerId);
    command = schemas.send.parse(parseMessageForm(scope.channelId, form));
  } catch {
    return refuse(messageUnsentNotice);
  }
  try {
    const response = await send(`${context.address(scope.ownerId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!response.ok)
      return refuse(
        notices(context.name)[response.status] ?? messageUnsentNotice,
        response.status >= 500,
      );
    // Receipt replay returns current content, which may include a later edit.
    const result = schemas.message.safeParse(await response.json());
    if (!result.success || result.data.channelId !== scope.channelId)
      return contextChatFormUnavailable(form);
    return contextChatSent(result.data.id, idSchema.parse(nextId()));
  } catch {
    return contextChatFormUnavailable(form);
  }
}
