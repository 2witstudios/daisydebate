import type { App } from '../../server/app';
import { createAppError } from '@daisy/errors';
import { createMediaService } from '@daisy/media';
import {
  noopErrorReporter,
  withTimeout,
  type ErrorReporter,
} from '@daisy/observability';
import { createMediaWorkerTokenBroker } from './worker-token';
import { mediaRuntime } from './projection';
import type { MediaOperationInput } from './operation-context';
import { createRoundMediaOperations } from './operations';
import { CAPTURE_STT_LAG_MS } from '../media-capture/policy';

/** Optional configuration stays inert until a real media operation is requested. */
export function createRoundMediaRuntime(
  app: App,
  reporter: ErrorReporter = noopErrorReporter,
) {
  let runtime: {
    operations: ReturnType<typeof createRoundMediaOperations>;
    workerTokens: ReturnType<typeof createMediaWorkerTokenBroker>;
  } | null = null;
  const get = () => {
    if (runtime) return runtime;
    const {
      LIVEKIT_URL: url,
      LIVEKIT_PUBLIC_URL: publicUrl,
      LIVEKIT_API_KEY: apiKey,
      LIVEKIT_API_SECRET: apiSecret,
    } = app.config;
    if (
      !url ||
      !publicUrl ||
      !apiKey ||
      !apiSecret ||
      new URL(publicUrl).protocol !== 'wss:'
    )
      throw createAppError('INFRASTRUCTURE');
    const worker = new URL(url);
    worker.protocol = worker.protocol === 'https:' ? 'wss:' : 'ws:';
    const resources: MediaOperationInput = {
      store: app.database.mediaSessions,
      media: createMediaService({ config: { url, apiKey, apiSecret } }),
      publicUrl,
      workerUrl: worker.toString(),
      nextId: () => app.ids.next(),
      reporter,
      logger: app.logger,
      deadline: (work) => withTimeout(work, 2_000),
      wait: () => Bun.sleep(25),
    };
    runtime = {
      operations: createRoundMediaOperations(resources),
      workerTokens: createMediaWorkerTokenBroker({
        sessions: resources.store,
        capture: app.database.createMediaCaptureOperations({
          sttLagMs: CAPTURE_STT_LAG_MS,
          nextId: resources.nextId,
          buildProjection: (context) =>
            mediaRuntime(context, resources.nextId).tick(context.now),
        }),
        media: resources.media,
        workerUrl: resources.workerUrl,
        nextId: resources.nextId,
        deadline: resources.deadline,
      }),
    };
    return runtime;
  };
  return {
    operations: () => get().operations,
    workerTokens: () => get().workerTokens,
  };
}
