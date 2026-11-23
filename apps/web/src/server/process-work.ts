import { repeatEvery } from '@daisy/worker';
import type { Waits } from '@daisy/clock';
import type { App } from './app';
import type { Stoppable } from './process-shutdown';
import { recordingPersistence } from '../features/recording/persistence';
import { startRecordingDeletions } from './recording-deletions';
import { startUsageRecovery } from './usage-recovery';
import { startBillingEconomics } from './billing-economics';
import { startBillingSubscriptions } from './billing-subscriptions';
import { startBillingRefunds } from './billing-refunds';
import { startBillingPurchases } from './billing-purchases';
import { startBroadcastSweep } from '../features/broadcast/composition';
import {
  startStrayEgressSweep,
  stopStageMedia,
} from '../features/stage-capture/composition';
import { startNotificationSweep } from '../features/spectating/audience-composition';
import { startRecordingCapture } from '../features/recording/composition';
import { recoveryFailureFields } from '../features/round-media/recovery-failure';
import { mediaConfigured } from './round-worker-policy';
import { provisionalLinkPurposes } from '../features/auth/mail/provisional-mail';
import { startRoundCompetitiveMaintenance } from './round-maintenance';
import { startRoomLifecycleMaintenance } from './room-maintenance';
import {
  createRoundMediaRuntime,
  stopRoundMedia,
} from '../features/round-media/composition';
import { startLaneGauges } from './lane-gauges';
import { startRoundMediaRecovery } from './round-media-recovery';
import { startRoundWorkers } from './round-workers';
import { startMessagingFileMaintenance } from './file-maintenance';
import { startObservationPurges } from './observation-purges';
import { privacyJobsQueue, startPrivacyJobs } from './privacy-jobs';
import { startPhotoDeletions } from '../features/profile/photo/deletion-sweep';
import { startBillingCleanup } from './billing-cleanup';
import { startRoundAvailability } from './round-availability';
import { startBetaMail } from './beta-mail';
import { startMediaReleaseMail } from './media-release-mail';
import { startLeagueRequestMail } from './league-request-mail';
import { startNotificationMail } from './notification-mail';
import { startOperatorApi } from './operator-api';
import { createRetentionSweep } from './retention-sweep';
import { retentionTargets } from './retention-targets';
import { waitForHealthy } from './wait-for-healthy';
import { createWorkWakes, keepWorkWakesListening } from './work-wakes';
import { readPublicCheckInProbe } from '../features/availability/configuration';

const HOUR_MS = 3_600_000;

/**
 * Every piece of background work the production server runs, started on
 * `app`, by name; an entry is null where its feature is not configured.
 * The production start stops them all on shutdown.
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
  const workWakes = createWorkWakes();
  const workWakeListen = keepWorkWakesListening({
    subscribe: () =>
      app.database.listenWorkWakes({
        onNotify: workWakes.wake,
        onListen: workWakes.wakeAll,
      }),
    unavailable: (cause) =>
      app.logger.log(
        'worker.wake.unavailable',
        { operation: 'worker.wake', cause },
        'Worker wakes unavailable; loops poll at their idle cap',
      ),
    waits: waits,
  });
  // ADR 0079: the private operator listener, only when keys are configured.
  // Its unexpected failures go to the app's scrubbed reporter (ADR 0037):
  // uninitialized without a DSN, so an unconfigured deployment stays inert.
  const operatorApi = await startOperatorApi(app, app.reporter);
  const mediaRuntime = mediaConfigured(app.config)
    ? createRoundMediaRuntime(app, waits)
    : null;
  const mediaRecovery = mediaRuntime
    ? startRoundMediaRecovery({
        recover: (listed) =>
          mediaRuntime.operations().recoverActiveSessions(listed),
        failed: (error) =>
          app.logger.log(
            'round.media.recovery_failed',
            {
              operation: 'round.media.recovery',
              errorCode: 'INFRASTRUCTURE',
              ...recoveryFailureFields(error),
            },
            'Media recovery remains pending',
          ),
        waits: waits,
        wake: workWakes.of('round'),
        probeRoundId:
          readPublicCheckInProbe(
            app.config.ATTENDANCE_PUBLIC_PROBE,
            app.config.PUBLIC_APP_URL,
          )?.roundId ?? null,
      })
    : null;
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
    waits: waits,
  });
  const availability = startRoundAvailability({
    app,
    fetch: probeFetch,
    waits: waits,
  });
  const roundMaintenance = startRoundCompetitiveMaintenance({
    app,
    instanceId: availability.instanceId,
    waits: waits,
    wake: workWakes.of('round'),
    ratingWake: workWakes.of('rating'),
    reporter: app.reporter,
  });
  const usageRecovery = startUsageRecovery({
    app,
    instanceId: availability.instanceId,
    waits: waits,
  });
  const billingEconomics = startBillingEconomics({
    app,
    instanceId: availability.instanceId,
    waits: waits,
  });
  const billingSubscriptions = startBillingSubscriptions({
    app,
    instanceId: availability.instanceId,
    waits: waits,
    fetch: vendorFetch,
  });
  const billingRefunds = startBillingRefunds({
    app,
    instanceId: availability.instanceId,
    waits: waits,
    fetch: vendorFetch,
  });
  const billingPurchases = startBillingPurchases({
    app,
    instanceId: availability.instanceId,
    waits: waits,
    fetch: vendorFetch,
  });
  const billingCleanup = startBillingCleanup({
    app,
    instanceId: availability.instanceId,
    waits: waits,
    fetch: vendorFetch,
  });
  const roomMaintenance = startRoomLifecycleMaintenance({
    app,
    waits: waits,
    reporter: app.reporter,
  });
  const roundWorkers = startRoundWorkers({
    app,
    instanceId: availability.instanceId,
    botMedia: mediaRuntime
      ? {
          botToken: (scope, token) =>
            mediaRuntime.operations().botToken(scope, token),
          listenToken: (scope, token) =>
            mediaRuntime.operations().botListenToken(scope, token),
          readPeers: (scope) => mediaRuntime.operations().botPeers(scope),
        }
      : null,
    waits: waits,
    wakes: workWakes,

    reporter: app.reporter,
  });
  // The one bounded retention sweep runs at start and then hourly in this
  // process; `unref` never holds it open. The start-up run waits for Redis to
  // answer first (ISSUE-146): a freshly started Fly machine's Redis connection
  // is not necessarily ready the instant this process is ready, and
  // readiness already reports 503 correctly during that window (a live check
  // per request, never a boot flag) — this only stops the sweep from logging
  // a spurious retention.sweep.failed on every cold boot.
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
    waits: waits,
    // Each run reports its own failure.
    failed: () => undefined,
  });
  const betaMail = startBetaMail({
    app,
    waits: waits,
    reporter: app.reporter,
  });
  const notificationMail = startNotificationMail({
    app,
    waits: waits,
    reporter: app.reporter,
  });
  const leagueRequestMail = startLeagueRequestMail({
    app,
    waits: waits,
    reporter: app.reporter,
  });
  const mediaReleaseMail = startMediaReleaseMail({
    app,
    waits: waits,
    reporter: app.reporter,
  });
  const fileRuntime = app.messagingFiles;
  const fileMaintenance = fileRuntime?.maintenance
    ? startMessagingFileMaintenance({
        maintenance: app.database.messagingFileMaintenance,
        config: fileRuntime.maintenance,
        remove: (key) => fileRuntime.objects.remove(key),
        clock: app.clock,
        logger: app.logger,
        waits: waits,
      })
    : null;
  // ISSUE-852: an erasure's queued observation purge is delivered, retried and
  // recorded here, so no cached copy of erased content outlives its job.
  const observationPurges = startObservationPurges({
    deliver: app.database.deliverObservationPurges,
    owed: () => app.database.owedObservationPurges(),
    purgeAll: () => app.redis.purgeAllObservations(),
    clock: app.clock,
    logger: app.logger,
    waits: waits,
  });
  // ISSUE-833: an erasure's queued vendor deletion jobs are delivered here,
  // retried with backoff and recorded, so no processor copy outlives its job.
  const privacyJobs = startPrivacyJobs({
    ...privacyJobsQueue(app),
    clock: app.clock,
    logger: app.logger,
    waits: waits,
  });
  const recordingDeletions = startRecordingDeletions({
    store: recordingPersistence(app),
    objects: app.recordingObjects,
    owner: app.ids.next(),
    clock: app.clock,
    logger: app.logger,
    waits: waits,
  });
  // ADR 0143: a rejected, removed, withdrawn or erased profile photo's image is
  // deleted here, then its row; storage outages leave the obligation owed.
  const photoDeletions = startPhotoDeletions({
    store: {
      due: app.database.duePhotoDeletions,
      complete: app.database.completePhotoDeletion,
      defer: app.database.deferPhotoDeletion,
      owed: app.database.owedPhotoDeletions,
    },
    objects: app.profilePhotoObjects,
    clock: app.clock,
    logger: app.logger,
    waits: waits,
  });
  const broadcastSweep = startBroadcastSweep(app, waits, workWakes.of('round'));
  const strayEgressSweep = startStrayEgressSweep(app, waits);
  const notificationSweep = startNotificationSweep(app, waits);
  const recordingCapture = startRecordingCapture(
    app,
    waits,
    workWakes.of('round'),
  );

  const workers: Readonly<Record<string, Stoppable | null | undefined>> = {
    retention,
    usageRecovery,
    billingEconomics,
    billingSubscriptions,
    billingRefunds,
    billingPurchases,
    billingCleanup,
    betaMail,
    notificationMail,
    leagueRequestMail,
    mediaReleaseMail,
    operatorApi,
    fileMaintenance,
    observationPurges,
    privacyJobs,
    photoDeletions,
    recordingDeletions,
    broadcastSweep,
    strayEgressSweep,
    notificationSweep,
    recordingCapture,
    availability,
    roundWorkers,
    laneGauges,
    mediaRecovery,
    roundMaintenance,
    roomMaintenance,
    workWakes: workWakeListen,
    // The node probes: this process's media runtime, the routes' and the stage's.
    mediaRuntime,
    roundMedia: { stop: () => stopRoundMedia(app) },
    stageMedia: { stop: () => stopStageMedia(app) },
  };
  return { workers, probeChecked: availability.probeChecked };
}
