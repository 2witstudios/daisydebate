import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { parseMessagingFormScope, formRequestId } from './form-scope';
export type MessagingFileFormState = {
  readonly requestId: string;
  readonly filename: string;
  readonly fileId?: string;
  readonly generation?: number;
  readonly notice?: string;
  readonly next?: string;
};
/** File bytes stay in the native request, never in action state, logs or hidden fields. */
export function parseMessagingFileForm(
  channel: unknown,
  message: unknown,
  input: unknown,
) {
  const scope = parseMessagingFormScope(channel, input),
    messageId = idSchema.safeParse(message),
    file = scope.form.get('file');
  if (
    !messageId.success ||
    !(file instanceof File) ||
    scope.form.getAll('file').length !== 1 ||
    file.size < 1
  )
    throw createAppError('VALIDATION');
  return { ...scope, messageId: messageId.data, file };
}
export function fileFormUnavailable(form: FormData): MessagingFileFormState {
  const file = form.get('file');
  return {
    requestId: formRequestId(form),
    filename: file instanceof File ? file.name : '',
    notice: 'Could not attach the file. Choose it again to retry.',
  };
}
