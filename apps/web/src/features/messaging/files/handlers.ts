import { requireFilePolicy } from '@daisy/db/messaging-files';
import { requireMessagingActor } from '../principal';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createMessagingFileSchemas, idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { readBytes, readJson, parseValidated } from '../../../server/http';
import { runMessagingHandler } from '../handler-boundary';
import { messagingFileResponse } from './download-response';
import type { FileDependencies } from './operations';
import {
  reserveMessagingFile,
  uploadMessagingFile,
  finalizeMessagingFile,
  renewMessagingFile,
  cancelMessagingFile,
  readMessagingFile,
} from './operations';
type JsonOperation = 'reserve' | 'finalize' | 'renew' | 'cancel';
const operations = {
  reserve: reserveMessagingFile,
  finalize: finalizeMessagingFile,
  renew: renewMessagingFile,
  cancel: cancelMessagingFile,
};
/** Native and direct clients consume the same origin/member and canonical file operations. */
export function createMessagingFileHandlers(input: {
  readonly boundary: Parameters<typeof runMessagingHandler>[0];
  readonly maxJsonBytes: number;
  readonly bounds: {
    readonly maxFileBytes: number;
    readonly maxFilenameUnits: number;
  };
  readonly dependencies: (
    principal: AuthorizationPrincipal,
  ) => FileDependencies;
}) {
  const json = (request: Request, kind: JsonOperation) =>
    runMessagingHandler(input.boundary, request, {
      name: `messaging.file.${kind}`,
      readOnly: false,
      readInput: () => readJson(request, input.maxJsonBytes),
      headers: fileBoundsHeaders(input.bounds),
      operation: async (command, principal) => {
        const result = await operations[kind](
          command,
          principal,
          input.dependencies(principal),
        );
        return result === undefined
          ? { version: 1, cancelled: true }
          : { version: 1, ...result };
      },
    });
  return {
    reserve: (request: Request) => json(request, 'reserve'),
    finalize: (request: Request) => json(request, 'finalize'),
    renew: (request: Request) => json(request, 'renew'),
    cancel: (request: Request) => json(request, 'cancel'),
    cleanup: (request: Request) =>
      runMessagingHandler(input.boundary, request, {
        name: 'messaging.file.cleanup',
        readOnly: false,
        readInput: () => readJson(request, input.maxJsonBytes),
        operation: async (value, principal) => {
          const command = parseValidated(
            createMessagingFileSchemas(input.bounds).cancel,
            value,
          );
          const actor = requireMessagingActor(principal);
          await input
            .dependencies(principal)
            .failPending(
              { ...actor, channelId: command.channelId },
              { fileId: command.fileId, generation: command.generation },
            );
          return { version: 1, cancelled: true };
        },
      }),
    list: (request: Request, channelId: string) =>
      runMessagingHandler(input.boundary, request, {
        name: 'messaging.file.list',
        headers: fileBoundsHeaders(input.bounds),
        readOnly: true,
        readInput: async () => {
          const params = new URL(request.url).searchParams;
          if (
            [...params.keys()].some((key) => key !== 'messageId') ||
            params.getAll('messageId').length !== 1
          )
            throw createAppError('VALIDATION');
          return parseValidated(idSchema, params.get('messageId'));
        },
        operation: async (value, principal) => {
          const messageId = parseValidated(idSchema, value),
            d = input.dependencies(principal);
          const actor = requireMessagingActor(principal);
          const files = await d.store.withChannel(
            { ...actor, channelId },
            'read',
            (frame) =>
              frame.listMessageFiles(
                [messageId],
                d.clock.now(),
                requireFilePolicy(d.policy),
              ),
          );
          return { version: 1, files };
        },
      }),
    upload: (request: Request, channelId: string, fileId: string) => {
      let bytes: Uint8Array | undefined;
      return runMessagingHandler(input.boundary, request, {
        name: 'messaging.file.upload',
        readOnly: false,
        readInput: async () => {
          const command = attachmentQuery(
            request,
            channelId,
            fileId,
            input.bounds,
          );
          if (
            request.headers.get('content-type') !== 'application/octet-stream'
          )
            throw createAppError('VALIDATION');
          bytes = await readBytes(request, input.bounds.maxFileBytes);
          return command;
        },
        operation: async (command, principal) => {
          if (!bytes) throw createAppError('VALIDATION');
          return {
            version: 1,
            ...(await uploadMessagingFile(
              command,
              bytes,
              principal,
              input.dependencies(principal),
            )),
          };
        },
      });
    },
    download: (request: Request, channelId: string, fileId: string) =>
      runMessagingHandler(input.boundary, request, {
        name: 'messaging.file.read',
        readOnly: true,
        readInput: async () =>
          attachmentQuery(request, channelId, fileId, input.bounds),
        operation: async (command, principal) =>
          messagingFileResponse(
            await readMessagingFile(
              command,
              principal,
              input.dependencies(principal),
            ),
          ),
        respond: (value) => {
          if (!(value instanceof Response))
            throw createAppError('INFRASTRUCTURE');
          return value;
        },
      }),
  };
}
function attachmentQuery(
  request: Request,
  channelId: string,
  fileId: string,
  bounds: { readonly maxFileBytes: number; readonly maxFilenameUnits: number },
) {
  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some((key) => key !== 'generation') ||
    params.getAll('generation').length !== 1
  )
    throw createAppError('VALIDATION');
  // Only a token shape is validated here; current authority comes from the same-tx operation.
  return parseValidated(createMessagingFileSchemas(bounds).access, {
    version: 1,
    channelId,
    fileId,
    generation: Number(params.get('generation')),
  });
}

function fileBoundsHeaders(bounds: {
  readonly maxFileBytes: number;
  readonly maxFilenameUnits: number;
}) {
  return {
    'x-messaging-file-bytes': String(bounds.maxFileBytes),
    'x-messaging-filename-units': String(bounds.maxFilenameUnits),
  };
}
