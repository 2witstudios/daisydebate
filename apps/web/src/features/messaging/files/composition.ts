import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../../server/app';
import { createAppError } from '@daisy/errors';
import { composeMessagingFileStore } from '../file-composition';
import { composeMessagingFileCleanup } from '../file-cleanup';
import type { FileDependencies } from './operations';
/** No file policy or private vendor is guessed when the deployment has no producer. */
export function messagingFileDependencies(
  app: App,
  principal: AuthorizationPrincipal,
): FileDependencies {
  const runtime = app.messagingFiles,
    policy = app.messagingPolicy;
  if (!runtime || !policy) throw createAppError('INFRASTRUCTURE');
  return {
    ...runtime,
    clock: app.clock,
    ids: app.ids,
    store: composeMessagingFileStore({
      database: app.database,
      principal,
      clock: app.clock,
      postingPolicy: policy.posting,
      readingPolicy: policy.reading,
      ...(policy.groupPosting === undefined
        ? {}
        : { groupPostingPolicy: policy.groupPosting }),
    }),
    failPending: composeMessagingFileCleanup({
      database: app.database,
      principal,
    }),
  };
}
