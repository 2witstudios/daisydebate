type Sampler = {
  readonly elect: () => Promise<boolean>;
  readonly sample: (evidence: {
    readonly publicProbeHealthy: boolean;
    readonly controlWorkersHealthy: boolean;
  }) => Promise<unknown>;
  readonly close: () => Promise<void>;
};
type Timers = {
  readonly setInterval: (tick: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};
/** Every peer renews its lease; only the actual elected session probes public ingress. */
export function startAvailabilityService(deps: {
  readonly instanceId: string;
  readonly store: {
    readonly renewServiceInstance: (input: {
      readonly instanceId: string;
      readonly role: 'web';
    }) => Promise<void>;
    readonly readRoundBotControlHealth: () => Promise<{
      readonly healthy: boolean;
    }>;
    readonly reconcileRoundCheckInAttempts: (limit: number) => Promise<number>;
    readonly availabilitySampler: () => Sampler;
  };
  readonly probe: () => Promise<boolean>;
  readonly timers: Timers;
  readonly failed: () => void;
}) {
  const sampler = deps.store.availabilitySampler();
  let stopped = false;
  let running: Promise<void> | null = null;
  const cycle = async () => {
    await deps.store.renewServiceInstance({
      instanceId: deps.instanceId,
      role: 'web',
    });
    if (!(await sampler.elect())) return;
    const [probe, control, reconciliation] = await Promise.allSettled([
      deps.probe(),
      deps.store.readRoundBotControlHealth(),
      deps.store.reconcileRoundCheckInAttempts(100),
    ]);
    await sampler.sample({
      publicProbeHealthy:
        reconciliation.status === 'fulfilled' &&
        probe.status === 'fulfilled' &&
        probe.value,
      controlWorkersHealthy:
        control.status === 'fulfilled' && control.value.healthy,
    });
  };
  const tick = () => {
    if (stopped || running) return;
    running = cycle()
      .catch(() => {
        deps.failed();
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = deps.timers.setInterval(tick, 1000);
  tick();
  return {
    async stop() {
      stopped = true;
      deps.timers.clearInterval(timer);
      await running;
      await sampler.close();
    },
  };
}
