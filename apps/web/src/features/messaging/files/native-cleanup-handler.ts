import { createAppError } from '@daisy/errors';
import { createMessagingFileSchemas } from '@daisy/protocol';
import { readBytes, parseValidated } from '../../../server/http';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { runMessagingHandler } from '../handler-boundary';
/** Own pending cleanup has its dedicated canonical capability, independently of posting eligibility. */
export function nativeFileCleanup(
  input: {
    readonly boundary: Parameters<typeof runMessagingHandler>[0];
    readonly maxBodyBytes: number;
    readonly bounds: { maxFileBytes: number; maxFilenameUnits: number };
    readonly cleanup: (request: Request) => Promise<Response>;
  },
  request: Request,
  channelId: string,
) {
  return runMessagingHandler(input.boundary, request, {
    name: 'messaging.file.discard',
    readOnly: false,
    readInput: async () => {
      if (
        request.headers.get('content-type')?.split(';')[0] !==
        'application/x-www-form-urlencoded'
      )
        throw createAppError('VALIDATION');
      const form = new URLSearchParams(
        new TextDecoder().decode(await readBytes(request, input.maxBodyBytes)),
      );
      if (
        [...form.keys()].some(
          (key) => key !== 'fileId' && key !== 'generation',
        ) ||
        form.getAll('fileId').length !== 1 ||
        form.getAll('generation').length !== 1
      )
        throw createAppError('VALIDATION');
      return parseValidated(createMessagingFileSchemas(input.bounds).cancel, {
        version: 1,
        channelId,
        fileId: form.get('fileId'),
        generation: Number(form.get('generation')),
      });
    },
    operation: async (command) => {
      const response = await inProcessFetch(input.cleanup, request.headers)(
        '/api/messaging/files/cleanup',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(command),
        },
      );
      if (!response.ok) return response;
      return new Response(null, {
        status: 303,
        headers: { location: `/messages/${channelId}` },
      });
    },
    respond: (value) => {
      if (!(value instanceof Response)) throw createAppError('INFRASTRUCTURE');
      return value;
    },
  });
}
