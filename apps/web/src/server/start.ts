import { repeatEvery } from '@daisy/worker';
import { hostWaits } from '@daisy/worker/host';

const HOUR_MS = 3_600_000;
import { loadBillingRoutes } from './billing-route-loader';
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
import { releaseFlagDefault } from '../features/flags/release-default';
import { readFileSync } from 'node:fs';
import next from 'next';
import { refuseSchemaAlteringRole } from '@daisy/db';
import {
  drainWithDeadline,
  installShutdownSignals,
} from '@daisy/observability';
import {
  closeProcessApp,
  initializeProcessBilling,
  processApp,
  processStartOptions,
  fetchPublicAttendanceProbe,
  processVendorFetch,
} from './process-app';
import { createRetentionSweep } from './retention-sweep';
import { retentionTargets } from './retention-targets';
import { startProductionServer } from './listen-first';
import { SHUTDOWN_DRAIN_DEADLINE_MS } from './shutdown-budget';
import { waitForHealthy } from './wait-for-healthy';
import { createWorkWakes, keepWorkWakesListening } from './work-wakes';
import { readPublicCheckInProbe } from '../features/availability/configuration';

// Refuses anything but NODE_ENV=production before building the app.
const { port, host } = processStartOptions();
initializeProcessBilling(loadBillingRoutes);
const app = processApp();
const nextApp = next({ dev: false, port });
// Production must not boot without validated auth configuration (secret,
// Resend sender/key, webhook secret, HTTPS origin): building the server
// reads it eagerly and its errors name fields only. startProductionServer
// opens the port first behind a start-up gate (ISSUE-172), refuses a
// DATABASE_URL role that could create or alter schema objects, prepares
// Next, and only then lets a request reach Next (ISSUE-39, ISSUE-193); a
// refusal rejects `started` and the process exits.
// Closed before the listener opens: a broken attendance probe is named before this
// process takes traffic. Settled below, once the check has run.
const probeCheck = Promise.withResolvers<void>();
app.holdReadinessUntil(probeCheck.promise);
const { server, started } = startProductionServer({
  app,
  nextApp,
  refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web'),
  // The one read of the route table, for the `gateway` keyword in
  // AUTH_TRUSTED_PROXIES (ISSUE-162); unreadable, it trusts nothing for it.
  readRouteTable: () => {
    try {
      return readFileSync('/proc/net/route', 'utf8');
    } catch {
      return null;
    }
  },
  port,
  host,
});
await started;
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
  waits: hostWaits,
});
// ADR 0079: the private operator listener, only when keys are configured.
// Its unexpected failures go to the app's scrubbed reporter (ADR 0037):
// uninitialized without a DSN, so an unconfigured deployment stays inert.
const operatorApi = await startOperatorApi(app, app.reporter);
const mediaRuntime = mediaConfigured(app.config)
  ? createRoundMediaRuntime(app, hostWaits)
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
      waits: hostWaits,
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
  waits: hostWaits,
});
const availability = startRoundAvailability({
  app,
  fetch: fetchPublicAttendanceProbe,
  waits: hostWaits,
});
// A slow read holds readiness at most 2 s: the check reports, it never refuses.
void Promise.race([availability.probeChecked, hostWaits.sleep(2000)]).finally(
  () => probeCheck.resolve(),
);
const roundMaintenance = startRoundCompetitiveMaintenance({
  app,
  instanceId: availability.instanceId,
  waits: hostWaits,
  wake: workWakes.of('round'),
  ratingWake: workWakes.of('rating'),
  reporter: app.reporter,
});
const usageRecovery = startUsageRecovery({
  app,
  instanceId: availability.instanceId,
  waits: hostWaits,
});
const billingEconomics = startBillingEconomics({
  app,
  instanceId: availability.instanceId,
  waits: hostWaits,
});
const billingSubscriptions = startBillingSubscriptions({
  app,
  instanceId: availability.instanceId,
  waits: hostWaits,
  fetch: processVendorFetch(),
});
const billingRefunds = startBillingRefunds({
  app,
  instanceId: availability.instanceId,
  waits: hostWaits,
  fetch: processVendorFetch(),
});
const billingPurchases = startBillingPurchases({
  app,
  instanceId: availability.instanceId,
  waits: hostWaits,
  fetch: processVendorFetch(),
});
const billingCleanup = startBillingCleanup({
  app,
  instanceId: availability.instanceId,
  waits: hostWaits,
  fetch: processVendorFetch(),
});
const roomMaintenance = startRoomLifecycleMaintenance({
  app,
  waits: hostWaits,
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
  waits: hostWaits,
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
      sleep: (ms) => hostWaits.sleep(ms),
      timeout: (ms) => hostWaits.sleep(ms),
    }),
  waits: hostWaits,
  // Each run reports its own failure.
  failed: () => undefined,
});
const betaMail = startBetaMail({
  app,
  waits: hostWaits,
  reporter: app.reporter,
});
const notificationMail = startNotificationMail({
  app,
  waits: hostWaits,
  reporter: app.reporter,
});
const leagueRequestMail = startLeagueRequestMail({
  app,
  waits: hostWaits,
  reporter: app.reporter,
});
const mediaReleaseMail = startMediaReleaseMail({
  app,
  waits: hostWaits,
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
      waits: hostWaits,
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
  waits: hostWaits,
});
// ISSUE-833: an erasure's queued vendor deletion jobs are delivered here,
// retried with backoff and recorded, so no processor copy outlives its job.
const privacyJobs = startPrivacyJobs({
  ...privacyJobsQueue(app),
  clock: app.clock,
  logger: app.logger,
  waits: hostWaits,
});
const recordingDeletions = startRecordingDeletions({
  store: recordingPersistence(app),
  objects: app.recordingObjects,
  owner: app.ids.next(),
  clock: app.clock,
  logger: app.logger,
  waits: hostWaits,
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
  waits: hostWaits,
});
const broadcastSweep = startBroadcastSweep(
  app,
  hostWaits,
  workWakes.of('round'),
);
const strayEgressSweep = startStrayEgressSweep(app, hostWaits);
const notificationSweep = startNotificationSweep(app, hostWaits);
const recordingCapture = startRecordingCapture(
  app,
  hostWaits,
  workWakes.of('round'),
);
async function shutdown() {
  if (app.isDraining()) return;
  app.drain();
  // Ends any sweep between batches; awaited before the pools close below.
  const retentionStopped = retention.stop();
  const usageRecoveryStopped = usageRecovery.stop();
  const billingEconomicsStopped = billingEconomics.stop();
  const billingSubscriptionsStopped = billingSubscriptions?.stop();
  const billingRefundsStopped = billingRefunds?.stop();
  const billingPurchasesStopped = billingPurchases?.stop();
  const billingCleanupStopped = billingCleanup.stop();
  const betaMailStopped = betaMail.stop();
  const notificationMailStopped = notificationMail.stop();
  const leagueRequestMailStopped = leagueRequestMail?.stop();
  const mediaReleaseMailStopped = mediaReleaseMail.stop();
  const operatorApiStopped = operatorApi?.stop();
  const filesStopped = fileMaintenance?.stop();
  const observationPurgesStopped = observationPurges.stop();
  const privacyJobsStopped = privacyJobs.stop();
  const photoDeletionsStopped = photoDeletions.stop();
  const recordingDeletionsStopped = recordingDeletions.stop();
  const broadcastSweepStopped = broadcastSweep?.stop();
  const strayEgressSweepStopped = strayEgressSweep?.stop();
  const notificationSweepStopped = notificationSweep.stop();
  const recordingCaptureStopped = recordingCapture?.stop();
  const availabilityStopped = availability.stop();
  const workersStopped = roundWorkers?.stop();
  const laneGaugesStopped = laneGauges.stop();
  const mediaRecoveryStopped = mediaRecovery?.stop();
  const roundMaintenanceStopped = roundMaintenance.stop();
  const roomMaintenanceStopped = roomMaintenance.stop();
  const workWakesStopped = workWakeListen.stop();
  // The node probes: this process's media runtime, the routes' and the stage's.
  const mediaRuntimeStopped = mediaRuntime?.stop();
  const roundMediaStopped = stopRoundMedia(app);
  const stageMediaStopped = stopStageMedia(app);
  app.logger.log(
    'server.shutdown',
    { operation: 'server.shutdown' },
    'Draining requests',
  );
  await drainWithDeadline({
    deadlineMs: SHUTDOWN_DRAIN_DEADLINE_MS,
    waits: hostWaits,
    onDeadlineExceeded: () => {
      // Announces any handed-off mail work the forced exit cuts off.
      app.reportUnfinishedWork();
      server.closeAllConnections();
      process.exit(1);
    },
    close: async () => {
      // Keep-alive sockets would otherwise hold close() until their idle timeout.
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await nextApp.close();
      await Promise.all([
        retentionStopped,
        usageRecoveryStopped,
        billingEconomicsStopped,
        billingSubscriptionsStopped,
        billingRefundsStopped,
        billingPurchasesStopped,
        billingCleanupStopped,
        betaMailStopped,
        notificationMailStopped,
        leagueRequestMailStopped,
        mediaReleaseMailStopped,
        operatorApiStopped,
        filesStopped,
        broadcastSweepStopped,
        strayEgressSweepStopped,
        notificationSweepStopped,
        recordingCaptureStopped,
        observationPurgesStopped,
        privacyJobsStopped,
        photoDeletionsStopped,
        recordingDeletionsStopped,
        availabilityStopped,
        workersStopped,
        mediaRecoveryStopped,
        roundMaintenanceStopped,
        workWakesStopped,
        roomMaintenanceStopped,
        laneGaugesStopped,
        mediaRuntimeStopped,
        roundMediaStopped,
        stageMediaStopped,
      ]);
      await closeProcessApp();
    },
  });
}
installShutdownSignals(shutdown);
