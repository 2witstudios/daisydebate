import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { readBytes, parseValidated } from '../../../server/http';
import { inProcessFetch } from '../../../server/in-process-fetch';

import { moved } from '../../forms/form-state';
import {
  fileFormUnavailable,
  fileStranded,
  isFileFormState,
  type MessagingFileFormState,
} from '../forms/file-form';
import { attachMessagingFormFile } from './form-upload';
import type { createMessagingFileHandlers } from './handlers';
import { runEvaluatedRoute } from '../../../server/member-boundary';
/** Multipart is bounded after origin/member validation, outside the 16 KiB action decoder. */
export function nativeFileHandler(
  input: {
    readonly boundary: Parameters<typeof runEvaluatedRoute>[0];
    readonly maxMultipartBytes: number;
    readonly files: ReturnType<typeof createMessagingFileHandlers>;
    readonly respond: (state: MessagingFileFormState) => Response;
  },
  request: Request,
  channel: unknown,
  message: unknown,
) {
  return runEvaluatedRoute(input.boundary, request, {
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
      const refusal = fileFormUnavailable(value.form);
      let kept: MessagingFileFormState = refusal;
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
              kept = fileStranded(refusal, token);
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
        return moved(`/messages/${value.channelId}`);
      } catch {
        return kept;
      }
    },
    respond: (value) => {
      if (!isFileFormState(value)) throw createAppError('INFRASTRUCTURE');
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
