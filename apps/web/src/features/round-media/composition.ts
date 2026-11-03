import { captureRule } from '@daisy/debate-engine';
import {
  createAdmissionPriority,
  MEDIA_ADMISSION_HINT_TIMEOUT_MS,
} from './admission-priority';
import type { App } from '../../server/app';
import { createAppError } from '@daisy/errors';
import { mediaEndpointsOf } from '@daisy/config';
import { createMediaNodes } from '@daisy/media';
import {
  noopErrorReporter,
  withTimeout,
  type ErrorReporter,
} from '@daisy/observability';
import { createRoundIncidentObserver } from '../round-incidents/observe';
import { createMediaWorkerTokenBroker } from './worker-token';
import { mediaRuntime } from './projection';
import type { MediaOperationInput } from './operation-context';
import { observeFloor } from './floor-telemetry';
import { createRoundMediaOperations } from './operations';
import { MEDIA_RECOVERY_HEARTBEAT_MS } from './recovery-due';
import { CAPTURE_STT_LAG_MS } from '@daisy/protocol';

/** How soon a dead node stops being offered to a new join. */
const MEDIA_NODE_PROBE_MS = 1_000;

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
    if (!url || !publicUrl || !apiKey || !apiSecret)
      throw createAppError('INFRASTRUCTURE');
    const apiUrls = mediaEndpointsOf(url);
    const publicUrls = mediaEndpointsOf(publicUrl);
    if (publicUrls.some((entry) => new URL(entry).protocol !== 'wss:'))
      throw createAppError('INFRASTRUCTURE');
    const nodes = createMediaNodes({
      nodes: apiUrls.map((entry, index) => ({
        url: entry,
        publicUrl: publicUrls[index]!,
      })),
      apiKey,
      apiSecret,
      fetch,
      healthChanged: (nodeIndex, healthy) =>
        app.logger.log(
          'round.media.node_health',
          { nodeIndex, cause: healthy ? 'up' : 'down' },
          'A media node changed health',
        ),
    });
    // One node has nowhere to fail over to, so it pays for no probe. The runtime lives
    // as long as the process, and the timer never holds it open.
    if (nodes.size > 1) {
      void nodes.probe();
      setInterval(() => void nodes.probe(), MEDIA_NODE_PROBE_MS).unref();
    }
    const resources: MediaOperationInput = {
      priority: createAdmissionPriority({
        deadline: (work) => withTimeout(work, MEDIA_ADMISSION_HINT_TIMEOUT_MS),
        hint: (...args) => app.redis.mediaAdmissionHint(...args),
        logger: app.logger,
      }),
      store: app.database.mediaSessions,
      media: nodes,
      urlsFor: nodes.urlsFor,
      readCaptureHeard: app.redis.readCaptureHeard,
      nextId: () => app.ids.next(),
      reporter,
      logger: app.logger,
      observeIncident: createRoundIncidentObserver({
        store: app.database.roundIncidents,
        reporter,
        logger: app.logger,
        nextId: () => app.ids.next(),
      }),
      deadline: (work) => withTimeout(work, 2_000),
      wait: () => Bun.sleep(25),
      now: () => Date.parse(app.clock.now()),
      recoveryHeartbeatMs: MEDIA_RECOVERY_HEARTBEAT_MS,
    };
    const floor = observeFloor(resources);
    const passes = createRoundMediaOperations(floor.input);
    const operations: typeof passes = {
      ...passes,
      recoverActiveSessions: () =>
        floor.asMover('tick', passes.recoverActiveSessions),
      holdForCapture: (sessionId, work) =>
        floor.asMover('capture', () => passes.holdForCapture(sessionId, work)),
    };
    runtime = {
      operations,
      workerTokens: createMediaWorkerTokenBroker({
        sessions: resources.store,
        capture: app.database.createMediaCaptureOperations({
          sttLagMs: CAPTURE_STT_LAG_MS,
          captureRule,
          nextId: resources.nextId,
          buildProjection: (context) =>
            mediaRuntime(context, resources.nextId).tick(context.now),
        }),
        media: floor.input.media,
        deferred: (cause, sessionId) =>
          app.logger.log(
            'media.capture.token_deferred',
            { cause, sessionId },
            'Capture token deferred',
          ),
        urlsFor: resources.urlsFor,
        nextId: resources.nextId,
        deadline: resources.deadline,
        hold: operations.holdForCapture,
      }),
    };
    return runtime;
  };
  return {
    operations: () => get().operations,
    workerTokens: () => get().workerTokens,
  };
}
