import { SERVICE_LEASE_WINDOW_MS } from '@daisy/db/service-lease-lapse';
import { createAppError } from '@daisy/errors';
import { guarded } from '@daisy/observability';
import type { WorkerTimers } from '../../lib/worker-timers';
import {
  afterRenewal,
  checkLease,
  delivered,
  RENEW_INTERVAL_MS,
  startingLease,
  type LeaseLapse,
  type LeaseRenewal,
} from './lease-health';

type Sampler = {
  readonly elect: () => Promise<boolean>;
  readonly sample: (evidence: {
    readonly publicProbeHealthy: boolean;
  }) => Promise<unknown>;
  readonly close: () => Promise<void>;
};
/** How often the elected sampler rechecks that the probe's resources exist. */
const PROBE_RESOURCE_CHECK_MS = 60 * 60_000;
/** How soon a failed check tries again. */
const PROBE_RESOURCE_RETRY_MS = 60_000;
/**
 * How long a renewal may stay in flight before the loop abandons it and
 * starts another: twice the lease window, past any bounded statement.
 */
const RENEWAL_DEADLINE_MS = 2 * SERVICE_LEASE_WINDOW_MS;

/** Every peer renews its lease; only the actual elected session probes public ingress. */
export function startAvailabilityService(deps: {
  readonly instanceId: string;
  readonly store: {
    readonly renewServiceInstance: (input: {
      readonly instanceId: string;
      readonly role: 'web';
    }) => Promise<void>;
    readonly reconcileRoundCheckInAttempts: (limit: number) => Promise<number>;
    readonly availabilitySampler: () => Sampler;
  };
  readonly probe: () => Promise<boolean>;
  /**
   * Whether the configured probe's resources still exist, read at start and
   * then hourly. Never decides health.
   */
  readonly probeResources?: () => Promise<readonly string[]>;
  readonly probeInvalid?: (problem: string) => void;
  /** Monotonic milliseconds. */
  readonly nowMs: () => number;
  readonly timers: WorkerTimers;
  /** A renewal or availability cycle failed, with its own error. */
  readonly failed: (error: unknown) => void;
  /**
   * This instance's lease has gone unproven by a timely renewal for 10 s
   * (DAISY-WEB-9): each channel is told once per streak, and the streak
   * re-arms only when a renewal proves the lease again. Never on a stop. A
   * channel that throws was not delivered, and is tried again next tick.
   */
  readonly lapsing: {
    readonly log: (lapse: LeaseLapse, streakId: string) => void;
    readonly report: (lapse: LeaseLapse, streakId: string) => void;
  };
  /** Mints the one id a streak's log line and report share, to join them. */
  readonly nextId: () => string;
}) {
  const { nowMs } = deps;
  let resourcesCheckedAt = Number.NEGATIVE_INFINITY;
  let checkingResources = false;
  /** Beside the cycle, never in it: pool pressure must not stall the sampler. */
  const checkProbeResources = async () => {
    if (
      !deps.probeResources ||
      checkingResources ||
      nowMs() - resourcesCheckedAt < PROBE_RESOURCE_CHECK_MS
    )
      return;
    checkingResources = true;
    try {
      const problems = await deps.probeResources();
      resourcesCheckedAt = nowMs();
      for (const problem of problems) deps.probeInvalid?.(problem);
    } catch {
      // Not every second, into the pressure that caused it.
      resourcesCheckedAt =
        nowMs() - PROBE_RESOURCE_CHECK_MS + PROBE_RESOURCE_RETRY_MS;
      deps.probeInvalid?.('check_failed');
    } finally {
      checkingResources = false;
    }
  };
  const sampler = deps.store.availabilitySampler();
  let stopped = false;
  let running: Promise<void> | null = null;
  let renewing: Promise<boolean> | null = null;
  const cycle = async () => {
    if (!(await sampler.elect())) return;
    void checkProbeResources();
    const [probe, reconciliation] = await Promise.allSettled([
      deps.probe(),
      deps.store.reconcileRoundCheckInAttempts(100),
    ]);
    await sampler.sample({
      publicProbeHealthy:
        reconciliation.status === 'fulfilled' &&
        probe.status === 'fulfilled' &&
        probe.value,
    });
  };
  /** A failure sink that throws never rejects the renewal or the cycle. */
  const failedSafely = (error: unknown) =>
    void guarded(() => deps.failed(error));
  let lease = startingLease(nowMs());
  const observe = (renewal: LeaseRenewal) => {
    lease = afterRenewal(lease, renewal);
  };
  /** Checked on every tick, so a renewal that hangs still counts as unproven. */
  let streakId = '';
  const checkHealth = () => {
    const due = checkLease(lease, nowMs());
    if (!due) return;
    // A streak not yet told on either channel is new: give it its one id.
    if (due.log && due.report) streakId = deps.nextId();
    // A channel counts only once it went out; reporting never stops renewals.
    if (due.log && guarded(() => deps.lapsing.log(due.lapse, streakId)))
      lease = delivered(lease, 'log');
    if (due.report && guarded(() => deps.lapsing.report(due.lapse, streakId)))
      lease = delivered(lease, 'report');
  };
  /** The renewal in flight: which attempt it is, and when it started. */
  let attempt = { id: 0, startedMs: 0 };
  const renew = () => {
    if (renewing && nowMs() - attempt.startedMs < RENEWAL_DEADLINE_MS)
      return renewing;
    if (renewing) {
      // Hung past its deadline: count it failed and start afresh, so one
      // renewal that never settles cannot stop all later ones.
      const hung = createAppError('INFRASTRUCTURE', 'Lease renewal hung');
      observe({ kind: 'failed', error: hung });
      failedSafely(hung);
    }
    const mine = { id: attempt.id + 1, startedMs: nowMs() };
    attempt = mine;
    const current = () => attempt.id === mine.id;
    // A store that throws synchronously still settles as a failed renewal.
    renewing = Promise.try(() =>
      deps.store.renewServiceInstance({
        instanceId: deps.instanceId,
        role: 'web',
      }),
    )
      .then(() => {
        // An abandoned renewal that settles late proves nothing now.
        if (!current()) return false;
        observe({
          kind: 'renewed',
          startedMs: mine.startedMs,
          settledMs: nowMs(),
        });
        return true;
      })
      .catch((error: unknown) => {
        if (!current()) return false;
        observe({ kind: 'failed', error });
        failedSafely(error);
        return false;
      })
      .finally(() => {
        if (current()) renewing = null;
      });
    return renewing;
  };
  const tick = () => {
    if (stopped) return;
    checkHealth();
    const renewal = renew();
    if (running) return;
    running = renewal
      .then((renewed) => (renewed ? cycle() : undefined))
      .catch((error: unknown) => {
        failedSafely(error);
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = deps.timers.setInterval(async () => tick(), RENEW_INTERVAL_MS);
  tick();
  return {
    /** Settles once this process has checked the probe's resources at start. */
    probeChecked: checkProbeResources(),
    async stop() {
      stopped = true;
      deps.timers.clearInterval(timer);
      await Promise.all([running, renewing]);
      await sampler.close();
    },
  };
}
