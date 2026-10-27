import { createRoundRuntime } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import type { App } from '../../server/app';
import { createBotActivityRelay } from '../round-bots/activity-relay';
import { createRoundMediaRuntime } from '../round-media/composition';
import { createMediaCaptureHandlers } from './handlers';
import { createCaptureHeardRelay } from './heard-relay';
import {
  CAPTURE_COVERAGE_TOLERANCE,
  CAPTURE_STT_LAG_MS,
} from '@daisy/protocol';

type Capture = ReturnType<App['database']['createMediaCaptureOperations']>;
/** Inert without configuration; the shared router mounts only this authenticated handler. */
export function composeMediaCaptureRoutes(app: App) {
  let capture: Capture | undefined;
  let authentication:
    ReturnType<typeof createMediaWorkerAuthentication> | undefined;
  const media = createRoundMediaRuntime(app);
  const operations = () =>
    (capture ??= app.database.createMediaCaptureOperations({
      sttLagMs: CAPTURE_STT_LAG_MS,
      coverageTolerance: CAPTURE_COVERAGE_TOLERANCE,
      nextId: () => app.ids.next(),
      buildProjection: ({ round, now }) =>
        createRoundRuntime({
          ...round,
          round,
          nextSegmentId: () => app.ids.next(),
        }).tick(now),
    }));
  const admission = {
    readCapture: (identity: Parameters<Capture['readMediaCaptureState']>[0]) =>
      operations().readMediaCaptureState(identity),
    readLease: (identity: Parameters<Capture['readCurrentCaptureLease']>[0]) =>
      operations().readCurrentCaptureLease(identity),
  };
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
    capture: operations,
    token: (scope, principal) =>
      media.workerTokens().captureToken(scope, principal),
    activity: createBotActivityRelay({
      ...admission,
      write: app.redis.writeBotActivity,
    }),
    heard: createCaptureHeardRelay({
      ...admission,
      write: app.redis.writeCaptureHeard,
    }),
  });
}
