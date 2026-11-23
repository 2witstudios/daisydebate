import type { Waits } from '@daisy/clock';
import { repeatEvery } from '@daisy/worker';
import { releaseFlagDefault } from '../features/flags/release-default';
import { startDataRightsWork } from '../features/account/data-rights/work';
import { provisionalLinkPurposes } from '../features/auth/mail/provisional-mail';
import { startBetaAccessWork } from '../features/beta-access/work';
import { startBillingWork } from '../features/billing/work';
import { startRoundAvailability } from '../features/availability/worker';
import { startBroadcastWork } from '../features/broadcast/work';
import { startLeagueRequestWork } from '../features/league-requests/work';
import { startMediaReleaseWork } from '../features/media-releases/work';
import { startMessagingWork } from '../features/messaging/work';
import { startNotificationWork } from '../features/notifications/work';
import { startOperatorApiWork } from '../features/operator-api/work';
import { startProfileWork } from '../features/profile/work';
import { startRecordingWork } from '../features/recording/work';
import { startRoomWork } from '../features/room-runtime/work';
import { startRoundFinalizationWork } from '../features/round-finalization/work';
import { createRoundMediaRuntime } from '../features/round-media/composition';
import { startRoundMediaWork } from '../features/round-media/work';
import { startCompetitiveRoundWork } from '../features/round-runtime/ai-work';
import { mediaConfigured } from '../features/round-runtime/worker-policy';
import { startSpectatingWork } from '../features/spectating/work';
import { startStageCaptureWork } from '../features/stage-capture/work';
import type { App } from './app';
import type { FeatureWork, Stoppable } from './feature-work';
import { startLaneGauges } from './lane-gauges';
import { createRetentionSweep } from './retention-sweep';
import { retentionTargets } from './retention-targets';
import { waitForHealthy } from './wait-for-healthy';
import {
  createWorkWakes,
  keepWorkWakesListening,
  type WorkWakes,
} from './work-wakes';

const HOUR_MS = 3_600_000;

/**
 * What a feature's background work receives: the app, and what the process
 * owns and every feature shares (injected time, the work wakes, this
 * instance's service identity, the vendor transport, the one round media
 * runtime).
 */
export type ProcessWork = {
  readonly app: App;
  readonly waits: Waits;
  /** Each loop's wake for the work it looks for (ADR 0154). */
  readonly wakes: WorkWakes;
  /** This instance's service identity, held by the availability lease. */
  readonly instanceId: string;
  /** Process-owned vendor transport (Stripe). */
  readonly vendorFetch: typeof globalThis.fetch;
  /** This process's round media runtime (recovery, bot seats); null without media. */
  readonly media: ReturnType<typeof createRoundMediaRuntime> | null;
};

/** One feature's start: its work, or null when nothing of it is configured. */
type StartWork = (
  process: ProcessWork,
) => FeatureWork | null | Promise<FeatureWork | null>;

/**
 * The one feature list: each feature with background work, one line each,
 * started in this order on the process's shared parts. A new feature's work
 * is one line here and nothing else.
 */
const featureWork: readonly StartWork[] = [
  startOperatorApiWork,
  startRoundMediaWork,
  startRoundFinalizationWork,
  startBillingWork,
  startRoomWork,
  startCompetitiveRoundWork,
  startBetaAccessWork,
  startNotificationWork,
  startLeagueRequestWork,
  startMediaReleaseWork,
  startMessagingWork,
  startDataRightsWork,
  startRecordingWork,
  startProfileWork,
  startBroadcastWork,
  startStageCaptureWork,
  startSpectatingWork,
];

/**
 * Every piece of background work the production server runs: first what
 * the process itself owns and shares (the work wakes, the availability
 * lease that gives this instance its identity, the database lane gauges,
 * the retention sweep across every feature's stores and the one round media
 * runtime), then each feature's
 * work. `running` names every loop that started; shutdown stops `workers`.
 */
export async function startProcessWork(input: {
  readonly app: App;
  readonly waits: Waits;
  /** Process-owned vendor transport (billing reconciliation). */
  readonly vendorFetch: typeof globalThis.fetch;
  /** The public attendance probe's transport, past captured mail. */
  readonly probeFetch: (url: string, init: RequestInit) => Promise<Response>;
}) {
  const { app, waits, vendorFetch, probeFetch } = input;
  // ADR 0118: the effective release-flag default, once per process. Only
  // staging may set DAISY_RELEASE_FLAG_DEFAULT; config refused it elsewhere.
  app.logger.log(
    'flags.release_default',
    {
      operation: 'flags.release_default',
      // `environment`: release flags with no stored choice are on (staging);
      // `catalogue`: each keeps its safe default (off).
      source: releaseFlagDefault(app.config) ? 'environment' : 'catalogue',
    },
    'Release flag default resolved',
  );
  // ADR 0154: each worker loop wakes on the work it looks for. Lossy hints:
  // while the LISTEN cannot start, every loop runs at its idle cap, and it is
  // tried again with back-off.
  const wakes = createWorkWakes();
  const workWakes = keepWorkWakesListening({
    subscribe: () =>
      app.database.listenWorkWakes({
        onNotify: wakes.wake,
        onListen: wakes.wakeAll,
      }),
    unavailable: (cause) =>
      app.logger.log(
        'worker.wake.unavailable',
        { operation: 'worker.wake', cause },
        'Worker wakes unavailable; loops poll at their idle cap',
      ),
    waits,
  });
  const availability = startRoundAvailability({
    app,
    fetch: probeFetch,
    waits,
  });
  const laneGauges = startLaneGauges({
    gauges: app.database.laneGauges,
    drainHolds: app.database.drainLaneHolds,
    log: ({ event, fields }) =>
      app.logger.log(
        event,
        fields,
        event === 'db.lane.window'
          ? 'One window of database lane use'
          : 'One operation held a database lane',
      ),
    detail: ['debug', 'trace'].includes(app.config.LOG_LEVEL),
    waits,
  });
  // The one bounded retention sweep runs at start and then hourly in this
  // process. The start-up run waits for Redis to answer first (ISSUE-146): a
  // freshly started Fly machine's Redis connection is not necessarily ready
  // the instant this process is ready, and readiness already reports 503
  // correctly during that window (a live check per request, never a boot
  // flag) — this only stops the sweep from logging a spurious
  // retention.sweep.failed on every cold boot.
  const retentionSweep = createRetentionSweep({
    targets: retentionTargets({
      database: app.database,
      redis: app.redis,
      provisionalLinks: provisionalLinkPurposes,
    }),
    clock: app.clock,
    logger: app.logger,
  });
  const retention = repeatEvery({
    everyMs: HOUR_MS,
    run: (signal) => retentionSweep.run(signal),
    runOnStart: true,
    ready: () =>
      waitForHealthy({
        health: () => app.redis.health(),
        sleep: (ms) => waits.sleep(ms),
        timeout: (ms) => waits.sleep(ms),
      }),
    waits,
    // Each run reports its own failure.
    failed: () => undefined,
  });
  const mediaRuntime = mediaConfigured(app.config)
    ? createRoundMediaRuntime(app, waits)
    : null;
  const process: ProcessWork = {
    app,
    waits,
    wakes,
    instanceId: availability.instanceId,
    vendorFetch,
    media: mediaRuntime,
  };
  const features: FeatureWork[] = [];
  for (const start of featureWork) {
    const started = await start(process);
    if (started) features.push(started);
  }
  const own = { workWakes, availability, laneGauges, retention, mediaRuntime };
  const owned = Object.entries(own).flatMap(([name, worker]) =>
    worker ? [{ name, worker }] : [],
  );
  const workers: readonly Stoppable[] = [
    ...owned.map(({ worker }) => worker),
    ...features,
  ];
  return {
    workers,
    running: [
      ...owned.map(({ name }) => name),
      ...features.flatMap((f) => f.running),
    ],
    probeChecked: availability.probeChecked,
    /** This instance's service identity. */
    instanceId: availability.instanceId,
  };
}
