import { loadBillingRoutes } from './billing-route-loader';
import { recordingPersistence } from '../features/recording/persistence';
import { startRecordingDeletions } from './recording-deletions';
import { startUsageRecovery } from './usage-recovery';
import { startBillingEconomics } from './billing-economics';
import { startBillingSubscriptions } from './billing-subscriptions';
import { startBillingRefunds } from './billing-refunds';
import { startBillingPurchases } from './billing-purchases';
import { startBroadcastSweep } from '../features/broadcast/composition';
import { startStrayEgressSweep } from '../features/stage-capture/composition';
import { startNotificationSweep } from '../features/spectating/audience-composition';
import { startRecordingCapture } from '../features/recording/composition';
import { recoveryFailureFields } from '../features/round-media/recovery-failure';
import { mediaConfigured } from './round-worker-policy';
import { provisionalLinkPurposes } from '../features/auth/mail/provisional-mail';
import { startRoundCompetitiveMaintenance } from './round-maintenance';
import { startRoomLifecycleMaintenance } from './room-maintenance';
import { createRoundMediaRuntime } from '../features/round-media/composition';
import { startLaneGauges } from './lane-gauges';
import { startRoundMediaRecovery } from './round-media-recovery';
import { startRoundWorkers } from './round-workers';
import { startMessagingFileMaintenance } from './file-maintenance';
import { startRunSchedule } from './run-schedule';
import { startObservationPurges } from './observation-purges';
import {
  privacyJobPort,
  startPrivacyJobs,
  genericPrivacyJobVendors,
} from './privacy-jobs';
import { startBillingCleanup } from './billing-cleanup';
import { startRoundAvailability } from './round-availability';
import { startBetaMail } from './beta-mail';
import type { OneShotTimer, WorkerTimers } from '../lib/worker-timers';
import { startOperatorApi } from './operator-api';
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
import { createRetentionSweep, retentionTargets } from './retention-sweep';
import { startProductionServer } from './listen-first';
import { SHUTDOWN_DRAIN_DEADLINE_MS } from './shutdown-budget';
import { waitForHealthy } from './wait-for-healthy';

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
// ADR 0079: the private operator listener, only when keys are configured.
// Its unexpected failures go to the app's scrubbed reporter (ADR 0037):
// uninitialized without a DSN, so an unconfigured deployment stays inert.
const operatorApi = await startOperatorApi(app, app.reporter);
const mediaRuntime = mediaConfigured(app.config)
  ? createRoundMediaRuntime(app)
  : null;
const mediaRecovery = mediaRuntime
  ? startRoundMediaRecovery({
      recover: () => mediaRuntime.operations().recoverActiveSessions(),
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
      every: (ms, tick) => {
        const handle = setInterval(tick, ms).unref();
        return { stop: () => clearInterval(handle) };
      },
    })
  : null;
const laneGauges = startLaneGauges({
  gauges: app.database.laneGauges,
  drainHolds: app.database.drainLaneHolds,
  log: (event, fields) =>
    app.logger.log(event, fields, 'One window of database lane use'),
  every: (ms, run) => {
    const handle = setInterval(run, ms).unref();
    return { stop: () => clearInterval(handle) };
  },
});
/** Process timers for the async worker loops; `unref` never holds the process open. */
const workerTimers: WorkerTimers = {
  setInterval: (tick, ms) =>
    setInterval(() => {
      void tick();
    }, ms).unref(),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};
/** Process one-shot timers for worker deadlines; `unref` never holds the process open. */
const oneShotTimer: OneShotTimer = {
  setTimeout: (run, ms) => setTimeout(run, ms).unref(),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const availability = startRoundAvailability({
  app,
  fetch: fetchPublicAttendanceProbe,
  timers: workerTimers,
});
// A slow read holds readiness at most 2 s: the check reports, it never refuses.
void Promise.race([
  availability.probeChecked,
  new Promise((settle) => oneShotTimer.setTimeout(() => settle(null), 2000)),
]).finally(() => probeCheck.resolve());
const roundMaintenance = startRoundCompetitiveMaintenance({
  app,
  instanceId: availability.instanceId,
  timers: workerTimers,
  reporter: app.reporter,
});
const usageRecovery = startUsageRecovery({
  app,
  instanceId: availability.instanceId,
  timers: workerTimers,
});
const billingEconomics = startBillingEconomics({
  app,
  instanceId: availability.instanceId,
  timers: workerTimers,
});
const billingSubscriptions = startBillingSubscriptions({
  app,
  instanceId: availability.instanceId,
  timers: workerTimers,
  fetch: processVendorFetch(),
});
const billingRefunds = startBillingRefunds({
  app,
  instanceId: availability.instanceId,
  timers: workerTimers,
  fetch: processVendorFetch(),
});
const billingPurchases = startBillingPurchases({
  app,
  instanceId: availability.instanceId,
  timers: workerTimers,
  fetch: processVendorFetch(),
});
const billingCleanup = startBillingCleanup({
  app,
  instanceId: availability.instanceId,
  timers: workerTimers,
  fetch: processVendorFetch(),
});
const roomMaintenance = startRoomLifecycleMaintenance({
  app,
  timers: workerTimers,
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
  timers: workerTimers,
  deadlineTimer: oneShotTimer,
  reporter: app.reporter,
});
// The one bounded retention sweep runs at start and then hourly in this
// process; `unref` never holds it open. The start-up run waits for Redis to
// answer first (ISSUE-146): a freshly started Fly machine's Redis connection
// is not necessarily ready the instant this process is ready, and
// readiness already reports 503 correctly during that window (a live check
// per request, never a boot flag) — this only stops the sweep from logging
// a spurious retention.sweep.failed on every cold boot.
const retention = startRunSchedule({
  work: createRetentionSweep({
    targets: retentionTargets({
      database: app.database,
      redis: app.redis,
      provisionalLinks: provisionalLinkPurposes,
    }),
    clock: app.clock,
    logger: app.logger,
  }),
  runOnStart: true,
  waitUntilReady: () =>
    waitForHealthy({
      health: () => app.redis.health(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      timeout: (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms).unref()),
    }),
  timers: workerTimers,
});
const betaMail = startBetaMail({
  app,
  timers: workerTimers,
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
      timers: workerTimers,
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
  timers: workerTimers,
});
// ISSUE-833: an erasure's queued vendor deletion jobs are delivered here,
// retried with backoff and recorded, so no processor copy outlives its job.
const privacyJobs = startPrivacyJobs({
  due: (batch) =>
    app.database.duePrivacyJobs({
      ...batch,
      vendors: genericPrivacyJobVendors(app),
    }),
  owed: () =>
    app.database.owedPrivacyJobs({ vendors: genericPrivacyJobVendors(app) }),
  deliver: (job, now, retryAt) =>
    app.database.deliverPrivacyJob(
      { jobId: job.id, vendor: job.vendor, now, retryAt },
      privacyJobPort(app, job.vendor),
    ),
  clock: app.clock,
  logger: app.logger,
  timers: workerTimers,
});
const recordingDeletions = startRecordingDeletions({
  store: recordingPersistence(app),
  objects: app.recordingObjects,
  owner: app.ids.next(),
  clock: app.clock,
  logger: app.logger,
  timers: workerTimers,
});
const broadcastSweep = startBroadcastSweep(app, workerTimers);
const strayEgressSweep = startStrayEgressSweep(app, workerTimers);
const notificationSweep = startNotificationSweep(app, workerTimers);
const recordingCapture = startRecordingCapture(app, workerTimers);
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
  const operatorApiStopped = operatorApi?.stop();
  const filesStopped = fileMaintenance?.stop();
  const observationPurgesStopped = observationPurges.stop();
  const privacyJobsStopped = privacyJobs.stop();
  const recordingDeletionsStopped = recordingDeletions.stop();
  const broadcastSweepStopped = broadcastSweep?.stop();
  const strayEgressSweepStopped = strayEgressSweep?.stop();
  const notificationSweepStopped = notificationSweep.stop();
  const recordingCaptureStopped = recordingCapture?.stop();
  const availabilityStopped = availability.stop();
  const workersStopped = roundWorkers?.stop();
  laneGauges.stop();
  const mediaRecoveryStopped = mediaRecovery?.stop();
  const roundMaintenanceStopped = roundMaintenance.stop();
  const roomMaintenanceStopped = roomMaintenance.stop();
  app.logger.log(
    'server.shutdown',
    { operation: 'server.shutdown' },
    'Draining requests',
  );
  await drainWithDeadline({
    deadlineMs: SHUTDOWN_DRAIN_DEADLINE_MS,
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
        operatorApiStopped,
        filesStopped,
        broadcastSweepStopped,
        strayEgressSweepStopped,
        notificationSweepStopped,
        recordingCaptureStopped,
        observationPurgesStopped,
        privacyJobsStopped,
        recordingDeletionsStopped,
        availabilityStopped,
        workersStopped,
        mediaRecoveryStopped,
        roundMaintenanceStopped,
        roomMaintenanceStopped,
      ]);
      await closeProcessApp();
    },
  });
}
installShutdownSignals(shutdown);
