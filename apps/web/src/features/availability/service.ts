import type { WorkerTimers } from '../../lib/worker-timers';

type Sampler = {
  readonly elect: () => Promise<boolean>;
  readonly sample: (evidence: {
    readonly publicProbeHealthy: boolean;
  }) => Promise<unknown>;
  readonly close: () => Promise<void>;
};
/** How often the elected sampler rechecks that the probe's resources exist. */
const PROBE_RESOURCE_CHECK_MS = 60 * 60_000;
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
   * then hourly. Null without a configured probe. Never decides health.
   */
  readonly probeResources?: () => Promise<readonly string[]>;
  readonly probeInvalid?: (problem: string) => void;
  /** Monotonic milliseconds. */
  readonly nowMs?: () => number;
  readonly timers: WorkerTimers;
  readonly failed: () => void;
}) {
  const nowMs = deps.nowMs ?? (() => performance.now());
  let resourcesCheckedAt = Number.NEGATIVE_INFINITY;
  let checkingResources = false;
  /** Beside the cycle, never in it: pool pressure must not stall the sampler. */
  const checkProbeResources = () => {
    if (
      !deps.probeResources ||
      checkingResources ||
      nowMs() - resourcesCheckedAt < PROBE_RESOURCE_CHECK_MS
    )
      return;
    checkingResources = true;
    void deps
      .probeResources()
      .then((problems) => {
        resourcesCheckedAt = nowMs();
        for (const problem of problems) deps.probeInvalid?.(problem);
      })
      .catch(() => deps.probeInvalid?.('check_failed'))
      .finally(() => {
        checkingResources = false;
      });
  };
  const sampler = deps.store.availabilitySampler();
  let stopped = false;
  let running: Promise<void> | null = null;
  let renewing: Promise<boolean> | null = null;
  const cycle = async () => {
    if (!(await sampler.elect())) return;
    checkProbeResources();
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
  const renew = () => {
    renewing ??= deps.store
      .renewServiceInstance({ instanceId: deps.instanceId, role: 'web' })
      .then(
        () => true,
        () => {
          deps.failed();
          return false;
        },
      )
      .finally(() => {
        renewing = null;
      });
    return renewing;
  };
  const tick = () => {
    if (stopped) return;
    const lease = renew();
    if (running) return;
    running = lease
      .then((renewed) => (renewed ? cycle() : undefined))
      .catch(() => {
        deps.failed();
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = deps.timers.setInterval(async () => tick(), 1000);
  tick();
  return {
    async stop() {
      stopped = true;
      deps.timers.clearInterval(timer);
      await Promise.all([running, renewing]);
      await sampler.close();
    },
  };
}
