/** Local readiness evidence only; this module never submits CAP consent. */
export type DeviceKind = 'camera' | 'microphone';
export type DeviceLoss =
  'track-ended' | 'device-disappeared' | 'permission-denied';
type Reason = DeviceLoss | 'selection-changed' | 'check-failed';
type Status = 'unchecked' | 'checking' | 'passed' | 'denied' | 'unavailable';
type Check = {
  readonly status: Status;
  readonly generation: number;
  /** Browser-local identities; never persist or send to CAP. */
  readonly selectedDeviceId: string | null;
  readonly deviceId: string | null;
  readonly reason: Reason | null;
};
export type DeviceCheckSnapshot = {
  readonly camera: Check;
  readonly microphone: Check;
  readonly devicesPassed: boolean;
};
export type DeviceInvalidation = {
  readonly kind: DeviceKind;
  readonly generation: number;
  readonly reason: Reason;
};
export type DeviceCapture = {
  readonly deviceId: string;
  readonly preview?: MediaStream;
  /** Resolves only after actual camera frames or nonzero microphone level. */
  confirm(signal: AbortSignal): Promise<void>;
  onLoss(callback: (reason: DeviceLoss) => void): () => void;
  stop(): void;
};
type Edge = {
  open(kind: DeviceKind, deviceId: string | null): Promise<DeviceCapture>;
};
type Listener = (
  snapshot: DeviceCheckSnapshot,
  event?: DeviceInvalidation,
) => void;
const initial = (): Check =>
  Object.freeze({
    status: 'unchecked',
    generation: 0,
    selectedDeviceId: null,
    deviceId: null,
    reason: null,
  });

function failureReason(error: unknown): DeviceLoss | 'check-failed' {
  const name =
    error && typeof error === 'object' && 'name' in error ? error.name : '';
  return name === 'NotAllowedError' || name === 'SecurityError'
    ? 'permission-denied'
    : 'check-failed';
}

export function createDeviceCheckController(edge: Edge) {
  const listeners = new Set<Listener>();
  const resources: Partial<
    Record<DeviceKind, { capture: DeviceCapture; unwatch: () => void }>
  > = {};
  const aborts: Partial<Record<DeviceKind, AbortController>> = {};
  let disposed = false;
  let snapshot: DeviceCheckSnapshot = Object.freeze({
    camera: initial(),
    microphone: initial(),
    devicesPassed: false,
  });
  const current = (kind: DeviceKind, generation: number) =>
    !disposed && snapshot[kind].generation === generation;
  const update = (
    kind: DeviceKind,
    check: Check,
    event?: DeviceInvalidation,
  ) => {
    const next = { ...snapshot, [kind]: Object.freeze(check) };
    snapshot = Object.freeze({
      ...next,
      devicesPassed:
        next.camera.status === 'passed' && next.microphone.status === 'passed',
    });
    for (const listener of listeners) listener(snapshot, event);
  };
  const release = (kind: DeviceKind) => {
    const resource = resources[kind];
    delete resources[kind];
    // Unsubscribe before stopping: intentional release is not a device failure.
    resource?.unwatch();
    aborts[kind]?.abort();
    delete aborts[kind];
    resource?.capture.stop();
  };
  const invalidate = (
    kind: DeviceKind,
    reason: Reason,
    selectedDeviceId = snapshot[kind].selectedDeviceId,
  ) => {
    if (disposed) return;
    const generation = snapshot[kind].generation + 1;
    update(
      kind,
      {
        generation,
        selectedDeviceId,
        deviceId: null,
        status:
          reason === 'selection-changed'
            ? 'unchecked'
            : reason === 'permission-denied'
              ? 'denied'
              : 'unavailable',
        reason,
      },
      { kind, generation, reason },
    );
    release(kind);
  };
  return {
    readSnapshot: () => snapshot,
    subscribe(listener: Listener) {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    preview: (kind: DeviceKind) => resources[kind]?.capture.preview ?? null,
    select(kind: DeviceKind, deviceId: string | null) {
      if (snapshot[kind].selectedDeviceId !== deviceId)
        invalidate(kind, 'selection-changed', deviceId);
    },
    async check(kind: DeviceKind) {
      if (disposed) return;
      const generation = snapshot[kind].generation + 1;
      update(kind, {
        ...snapshot[kind],
        generation,
        status: 'checking',
        reason: null,
        deviceId: null,
      });
      if (!current(kind, generation)) return;
      release(kind);
      const abort = new AbortController();
      aborts[kind] = abort;
      try {
        const capture = await edge.open(kind, snapshot[kind].selectedDeviceId);
        if (!current(kind, generation)) {
          capture.stop();
          return;
        }
        resources[kind] = {
          capture,
          unwatch: capture.onLoss((reason) => {
            if (current(kind, generation)) invalidate(kind, reason);
          }),
        };
        update(kind, { ...snapshot[kind], deviceId: capture.deviceId });
        await capture.confirm(abort.signal);
        if (current(kind, generation))
          update(kind, { ...snapshot[kind], status: 'passed' });
      } catch (error) {
        if (!current(kind, generation)) return;
        invalidate(kind, failureReason(error));
      }
    },
    dispose(_reason: 'departure' | 'round-transition') {
      if (disposed) return;
      disposed = true;
      for (const kind of ['camera', 'microphone'] as const) {
        update(kind, {
          ...snapshot[kind],
          generation: snapshot[kind].generation + 1,
          status: 'unchecked',
          reason: null,
          deviceId: null,
        });
        release(kind);
      }
      listeners.clear();
    },
  };
}
