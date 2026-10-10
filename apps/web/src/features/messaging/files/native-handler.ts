import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { readBytes, parseValidated } from '../../../server/http';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { runMessagingHandler } from '../handler-boundary';
import {
  fileFormUnavailable,
  type MessagingFileFormState,
} from '../forms/file-form';
import { attachMessagingFormFile } from './form-upload';
import type { createMessagingFileHandlers } from './handlers';
/** Multipart is bounded after origin/member validation, outside the 16 KiB action decoder. */
export function nativeFileHandler(
  input: {
    readonly boundary: Parameters<typeof runMessagingHandler>[0];
    readonly maxMultipartBytes: number;
    readonly files: ReturnType<typeof createMessagingFileHandlers>;
    readonly respond: (state: MessagingFileFormState) => Response;
  },
  request: Request,
  channel: unknown,
  message: unknown,
) {
  return runMessagingHandler(input.boundary, request, {
    name: 'messaging.file.attach',
    readOnly: false,
    readInput: async () => {
      const channelId = parseValidated(idSchema, channel),
        messageId = parseValidated(idSchema, message);
      const type = request.headers.get('content-type');
      if (!type?.startsWith('multipart/form-data;'))
        throw createAppError('VALIDATION');
      const bytes = await readBytes(request, input.maxMultipartBytes);
      const form = await multipartForm(request.url, type, bytes);
      return { channelId, messageId, form };
    },
    operation: async (value) => {
      // Values are validated again by the common form parser and each actual operation.
      if (!isNativeForm(value)) throw createAppError('VALIDATION');
      let kept = fileFormUnavailable(value.form);
      const json =
        (handler: (request: Request) => Promise<Response>, path: string) =>
        (command: unknown) =>
          inProcessFetch(handler, request.headers)(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(command),
          });
      try {
        await attachMessagingFormFile(
          value.channelId,
          value.messageId,
          value.form,
          {
            reserved: (token) => {
              kept = {
                ...kept,
                fileId: token.fileId,
                generation: token.generation,
              };
            },
            reserve: json(input.files.reserve, '/api/messaging/files/reserve'),
            finalize: json(
              input.files.finalize,
              '/api/messaging/files/finalize',
            ),
            upload: (channelId, fileId, generation, bytes) =>
              inProcessFetch(
                (upload) => input.files.upload(upload, channelId, fileId),
                request.headers,
              )(
                `/api/messaging/channels/${channelId}/files/${fileId}/upload?generation=${generation}`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/octet-stream' },
                  body: bytes,
                },
              ),
          },
        );
        return { ...kept, notice: '', next: `/messages/${value.channelId}` };
      } catch {
        return kept;
      }
    },
    respond: (value) => {
      if (!isFormState(value)) throw createAppError('INFRASTRUCTURE');
      return input.respond(value);
    },
  });
}
function isNativeForm(
  value: unknown,
): value is { channelId: string; messageId: string; form: FormData } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'channelId' in value &&
    typeof value.channelId === 'string' &&
    'messageId' in value &&
    typeof value.messageId === 'string' &&
    'form' in value &&
    value.form instanceof FormData
  );
}
function isFormState(value: unknown): value is MessagingFileFormState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'filename' in value &&
    typeof value.filename === 'string'
  );
}

async function multipartForm(
  url: string,
  type: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  try {
    return await new Request(url, {
      method: 'POST',
      headers: { 'content-type': type },
      body: bytes,
    }).formData();
  } catch {
    throw createAppError('VALIDATION');
  }
}
