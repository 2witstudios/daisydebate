import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { Idle, Moved, Refused } from '../../forms/form-state';
import { parseMessagingFormScope, formRequestId } from './form-scope';

/** The request an attachment posts under and the name of the file it chose. */
type FileValues = {
  readonly values: { readonly requestId: string; readonly filename: string };
};
export type FileRefused = Refused & FileValues;
/** Refused after bytes were reserved: the upload it names is still held and can be discarded. */
export type FileStranded = {
  readonly kind: 'stranded';
  readonly values: FileValues['values'];
  readonly error: string;
  readonly fileId: string;
  readonly generation: number;
};

/** An attachment form's answer. */
export type MessagingFileFormState =
  (Idle & FileValues) | FileRefused | FileStranded | Moved;

export const fileFormIdle = (requestId: string): MessagingFileFormState => ({
  kind: 'idle',
  values: { requestId, filename: '' },
});

/** The same refusal, now naming the upload reserved before it failed. */
export const fileStranded = (
  refusal: FileRefused | FileStranded,
  upload: { readonly fileId: string; readonly generation: number },
): FileStranded => ({
  kind: 'stranded',
  values: refusal.values,
  error: refusal.error,
  fileId: upload.fileId,
  generation: upload.generation,
});

const fileAnswerKinds: readonly string[] = [
  'idle',
  'refused',
  'stranded',
  'moved',
] satisfies readonly MessagingFileFormState['kind'][];

/** Whether a route's untyped result is an attachment answer. */
export const isFileFormState = (
  value: unknown,
): value is MessagingFileFormState =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  typeof value.kind === 'string' &&
  fileAnswerKinds.includes(value.kind);

/** What an attachment form renders from each answer. */
export type FileFields = {
  readonly requestId: string;
  readonly filename: string;
  readonly notice: string | undefined;
  /** The reserved upload a refusal left behind, which its member may discard. */
  readonly held:
    { readonly fileId: string; readonly generation: number } | undefined;
};

export function fileFields(answer: MessagingFileFormState): FileFields {
  switch (answer.kind) {
    case 'idle':
      return { ...answer.values, notice: undefined, held: undefined };
    case 'refused':
      return { ...answer.values, notice: answer.error, held: undefined };
    case 'stranded':
      return {
        ...answer.values,
        notice: answer.error,
        held: { fileId: answer.fileId, generation: answer.generation },
      };
    case 'moved':
      return {
        requestId: '',
        filename: '',
        notice: undefined,
        held: undefined,
      };
  }
}
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
export function fileFormUnavailable(form: FormData): FileRefused {
  const file = form.get('file');
  return {
    kind: 'refused',
    values: {
      requestId: formRequestId(form),
      filename: file instanceof File ? file.name : '',
    },
    error: 'Could not attach the file. Choose it again to retry.',
  };
}
