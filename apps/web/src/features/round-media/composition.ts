import { defineComposition } from '../../server/composition';
import { memberHttpBoundary } from '../../server/member-boundary';
import { createRoundMediaHandlers } from './handlers';
import { captureAdmissionPolicy } from '../media-capture/capture-policy';
import { nowMs, type Waits } from '@daisy/clock';
import { repeatEvery, type RepeatWorker } from '@daisy/worker';
import { createRoundStartGate } from '../round-start-gate/gate';
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
import { CAPTURE_STT_LAG_MS } from '@daisy/protocol/capture-timing';

/** How soon a dead node stops being offered to a new join. */
const MEDIA_NODE_PROBE_MS = 1_000;

type RoundMediaStop = { readonly stop: () => Promise<void> };

/** Every round media runtime composed for an app, so its shutdown stops them all. */
const composedFor = new WeakMap<App, Set<RoundMediaStop>>();
/** Apps whose round media was stopped: a runtime composed after starts no probe. */
const stoppedApps = new WeakSet<App>();

/**
 * Stops the node probe of every round media runtime composed for `app` (the
 * process's own and the routes'); the process's shutdown awaits it. A
 * runtime composed for the app afterwards starts no probe.
 */
export const stopRoundMedia = async (app: App): Promise<void> => {
  stoppedApps.add(app);
  await Promise.all(
    [...(composedFor.get(app) ?? [])].map((runtime) => runtime.stop()),
  );
};

/**
 * Optional configuration stays inert until a real media operation is
 * requested. Its node probe, once started, runs on `waits` until `stop`
 * (or `stopRoundMedia` for its app).
 */
export function createRoundMediaRuntime(
  app: App,
  waits: Waits,
  reporter: ErrorReporter = noopErrorReporter,
) {
  /** The node probe: not started, running, or stopped for good. */
  let probe: RepeatWorker | 'stopped' | null = stoppedApps.has(app)
    ? 'stopped'
    : null;
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
      waits,
      healthChanged: (nodeIndex, healthy) =>
        app.logger.log(
          'round.media.node_health',
          { nodeIndex, cause: healthy ? 'up' : 'down' },
          'A media node changed health',
        ),
    });
    // One node has nowhere to fail over to, so it pays for no probe. The runtime lives
    // as long as the process; its owner stops the probe at shutdown, and a
    // runtime first composed after that starts none.
    if (nodes.size > 1 && probe !== 'stopped')
      probe = repeatEvery({
        waits,
        everyMs: MEDIA_NODE_PROBE_MS,
        runOnStart: true,
        run: () => nodes.probe(),
        // A probe settles every node's fault as down; only a throwing health
        // log rejects it, and the next run logs again.
        failed: () => {},
      });
    const resources: MediaOperationInput = {
      priority: createAdmissionPriority({
        deadline: (work) =>
          withTimeout(waits, work, MEDIA_ADMISSION_HINT_TIMEOUT_MS),
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
      awaitCapture: createRoundStartGate({
        store: app.database.roundStartGates,
        nextId: () => app.ids.next(),
      }).awaitCapture,
      observeIncident: createRoundIncidentObserver({
        store: app.database.roundIncidents,
        reporter,
        logger: app.logger,
        nextId: () => app.ids.next(),
      }),
      deadline: (work) => withTimeout(waits, work, 2_000),
      wait: () => waits.sleep(25),
      now: () => nowMs(app.clock),
      recoveryHeartbeatMs: MEDIA_RECOVERY_HEARTBEAT_MS,
    };
    const floor = observeFloor(resources);
    const passes = createRoundMediaOperations(floor.input);
    const operations: typeof passes = {
      ...passes,
      recoverActiveSessions: (listed) =>
        floor.asMover('tick', () => passes.recoverActiveSessions(listed)),
      holdForCapture: (sessionId, work) =>
        floor.asMover('capture', () => passes.holdForCapture(sessionId, work)),
    };
    runtime = {
      operations,
      workerTokens: createMediaWorkerTokenBroker({
        sessions: resources.store,
        capture: app.database.createMediaCaptureOperations({
          admission: captureAdmissionPolicy,
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
  const stoppable: RoundMediaStop = {
    /** Ends the node probe, if one started; none starts after. */
    stop: async () => {
      const running = probe;
      probe = 'stopped';
      if (running !== null && running !== 'stopped') await running.stop();
    },
  };
  const composed = composedFor.get(app) ?? new Set<RoundMediaStop>();
  composed.add(stoppable);
  composedFor.set(app, composed);
  return {
    operations: () => get().operations,
    workerTokens: () => get().workerTokens,
    stop: stoppable.stop,
  };
}

/** round-media: its route files bind here (`processRoute`). */
export const roundMediaComposition = defineComposition('round-media', (app) =>
  createRoundMediaHandlers({
    ...memberHttpBoundary(app),
    operations: createRoundMediaRuntime(app, app.waits).operations,
  }),
);
