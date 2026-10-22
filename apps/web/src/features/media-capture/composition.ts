import { createRoundRuntime } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import type { App } from '../../server/app';
import { createRoundMediaRuntime } from '../round-media/composition';
import { createMediaCaptureHandlers } from './handlers';

/** Inert without configuration; the shared router mounts only this authenticated handler. */
export function composeMediaCaptureRoutes(app: App) {
  let capture:
    ReturnType<App['database']['createMediaCaptureOperations']> | undefined;
  let authentication:
    ReturnType<typeof createMediaWorkerAuthentication> | undefined;
  const media = createRoundMediaRuntime(app);
  return createMediaCaptureHandlers({
    logger: app.logger,
    authentication: () => {
      const secret = app.config.MEDIA_WORKER_SECRET;
      if (!secret) throw createAppError('INFRASTRUCTURE');
      return (authentication ??= createMediaWorkerAuthentication({
        secret,
        now: () => Date.parse(app.clock.now()),
      }));
    },
    capture: () =>
      (capture ??= app.database.createMediaCaptureOperations({
        nextId: () => app.ids.next(),
        buildProjection: ({ round, now }) =>
          createRoundRuntime({
            ...round,
            round,
            nextSegmentId: () => app.ids.next(),
          }).tick(now),
      })),
    token: (scope, principal) =>
      media.workerTokens().captureToken(scope, principal),
  });
}
