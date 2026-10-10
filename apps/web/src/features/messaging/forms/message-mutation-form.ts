import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  parseMessageForm,
  messageFormUnavailable,
  type MessageFormState,
} from './send-form';
import { parseMessagingFormScope } from './form-scope';
/** Current author and cleanup/posting permissions are checked by the existing operation. */
export function parseMessageMutationForm(
  channel: unknown,
  message: unknown,
  input: unknown,
) {
  const { form, channelId, requestId } = parseMessagingFormScope(
    channel,
    input,
  );
  const messageId = idSchema.safeParse(message);
  const operation = form.get('operation');
  if (
    !messageId.success ||
    form.getAll('operation').length !== 1 ||
    (operation !== 'edit' && operation !== 'remove')
  )
    throw createAppError('VALIDATION');
  const command =
    operation === 'edit'
      ? { ...parseMessageForm(channel, input), messageId: messageId.data }
      : {
          version: 1 as const,
          channelId,
          messageId: messageId.data,
          requestId,
        };
  return { operation, command };
}
export function messageMutationUnavailable(form: FormData): MessageFormState {
  return {
    ...messageFormUnavailable(form),
    notice: 'Your message could not be changed. The text is kept; try again.',
  };
}
