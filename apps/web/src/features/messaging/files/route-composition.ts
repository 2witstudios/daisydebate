import { nativeFileCleanup } from './native-cleanup-handler';
import { nativeFileHandler } from './native-handler';
import type { MessagingFileFormState } from '../forms/file-form';
import type { App } from '../../../server/app';
import {
  messagingHttpBoundary,
  unavailableMessagingHandler,
} from '../handler-boundary';
import { messagingFileDependencies } from './composition';
import { createMessagingFileHandlers } from './handlers';
/** Absence of explicit storage/scanner/policy remains unavailable at every mounted edge. */
export function composeMessagingFileRoutes(app: App) {
  const configured = () => {
    const runtime = app.messagingFiles;
    if (!runtime || !app.messagingPolicy) return null;
    return createMessagingFileHandlers({
      boundary: messagingHttpBoundary(app),
      maxJsonBytes: app.messagingPolicy.maxBodyBytes,
      bounds: runtime.policy,
      dependencies: (principal) => messagingFileDependencies(app, principal),
    });
  };
  const json =
    (kind: 'reserve' | 'finalize' | 'renew' | 'cancel' | 'cleanup') =>
    (request: Request) =>
      configured()?.[kind](request) ??
      unavailableMessagingHandler(app, request);
  const binary =
    (kind: 'upload' | 'download') =>
    (request: Request, channelId: string, fileId: string) =>
      configured()?.[kind](request, channelId, fileId) ??
      unavailableMessagingHandler(app, request);
  return {
    attach: (
      request: Request,
      channelId: string,
      messageId: string,
      respond: (state: MessagingFileFormState) => Response,
    ) => {
      const files = configured(),
        runtime = app.messagingFiles;
      if (!files || !runtime) return unavailableMessagingHandler(app, request);
      return nativeFileHandler(
        {
          boundary: messagingHttpBoundary(app),
          maxMultipartBytes: runtime.maxMultipartBytes,
          files,
          respond,
        },
        request,
        channelId,
        messageId,
      );
    },
    discard: (request: Request, channelId: string) => {
      const files = configured(),
        runtime = app.messagingFiles,
        policy = app.messagingPolicy;
      if (!files || !runtime || !policy)
        return unavailableMessagingHandler(app, request);
      return nativeFileCleanup(
        {
          boundary: messagingHttpBoundary(app),
          maxBodyBytes: policy.maxBodyBytes,
          bounds: runtime.policy,
          cleanup: files.cleanup,
        },
        request,
        channelId,
      );
    },
    reserve: json('reserve'),
    finalize: json('finalize'),
    renew: json('renew'),
    cancel: json('cancel'),
    cleanup: json('cleanup'),
    list: (request: Request, channelId: string) =>
      configured()?.list(request, channelId) ??
      unavailableMessagingHandler(app, request),
    upload: binary('upload'),
    download: binary('download'),
  };
}
