import type { Waits } from '@daisy/clock';
import { repeatEvery } from '@daisy/worker';
import { startDataRightsWork } from '../features/account/data-rights/work';
import { provisionalLinkPurposes } from '../features/auth/mail/provisional-mail';
import { startBetaAccessWork } from '../features/beta-access/work';
import { startBillingWork } from '../features/billing/work';
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
import { startRoundMediaWork } from '../features/round-media/work';
import { startSpectatingWork } from '../features/spectating/work';
import { startStageCaptureWork } from '../features/stage-capture/work';
import type { App } from './app';
import type { FeatureWork, StartWork, Stoppable } from './feature-work';
import { startLaneGauges } from './lane-gauges';
import { createRetentionSweep } from './retention-sweep';
import { retentionTargets } from './retention-targets';
import { startRoundAvailability } from './round-availability';
import { startCompetitiveRoundWork } from './round-workers';
import { waitForHealthy } from './wait-for-healthy';
import { createWorkWakes, keepWorkWakesListening } from './work-wakes';

const HOUR_MS = 3_600_000;

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
 * lease that gives this instance its identity, the database lane gauges and
 * the retention sweep across every feature's stores), then each feature's
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
  const process = {
    app,
    waits,
    wakes,
    instanceId: availability.instanceId,
    vendorFetch,
  };
  const features: FeatureWork[] = [];
  for (const start of featureWork) {
    const started = await start(process);
    if (started) features.push(started);
  }
  const own = { workWakes, availability, laneGauges, retention };
  const workers: readonly Stoppable[] = [...Object.values(own), ...features];
  return {
    workers,
    running: [...Object.keys(own), ...features.flatMap((f) => f.running)],
    probeChecked: availability.probeChecked,
    /** This instance's service identity. */
    instanceId: availability.instanceId,
  };
}
