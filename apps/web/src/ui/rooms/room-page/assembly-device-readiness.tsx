'use client';

import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';

import {
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  useRef,
  type ReactNode,
} from 'react';
import { systemId } from '@daisy/clock';
import { isNamedSeat, type RoomView } from '@daisy/protocol';
import { createLocalConsent } from '../../../features/rooms/local-consent';
import { createBrowserDeviceChecks } from '../../../features/video/browser-device-checks';
import type { DeviceKind } from '../../../features/video/device-check-controller';
import type { RoomRead } from '../../../features/rooms/read-assembly';
import type { submitAssembly } from '../../../features/rooms/submit-assembly';
import { StartControl, ReadyControl } from './assembly-readiness';
import { createLocalCommandAction } from '../../../features/rooms/local-command-action';
import { buttonClass } from '../../components/button/button-class';
import type { LocalReadiness } from './assembly-controls';
import { CameraPreview, DeviceChoice } from './device-check';
import { RoomSyncContext } from './room-sync-context';

type Props = {
  /** Seats and the round setup summary: the right-hand column below Start. */
  readonly side: ReactNode;
  /** Prep before the round, inside the Start card; null when the format has none. */
  readonly prep: ReactNode;
  readonly view: RoomView;
  readonly actorId: string;
  readonly action: FormAction<RoomFormState>;
  readonly send: (form: FormData) => ReturnType<typeof submitAssembly>;
  readonly read: () => Promise<RoomRead>;
  readonly commandIds: Parameters<typeof ReadyControl>[0]['commandIds'];
};
type Devices = ReturnType<typeof createBrowserDeviceChecks>;
type Consent = ReturnType<typeof createLocalConsent>;

function GatheringLayout({
  props,
  view,
  action,
  local,
  devices,
}: {
  readonly props: Props;
  readonly view: RoomView;
  readonly action: FormAction<RoomFormState>;
  readonly local: LocalReadiness;
  readonly devices: ReactNode;
}) {
  const controls = { ...props, view, action, local };
  const ready = ReadyControl(controls);
  const side = (
    <div className="room-side flex min-w-0 flex-col gap-4">
      {StartControl({ ...controls, prep: props.prep })}
      {props.side}
    </div>
  );
  if (!devices && !ready) return side;
  return (
    <div className="grid room-gathering items-start gap-6">
      <section
        aria-label="Your devices"
        className="room-devices flex min-w-0 flex-col gap-3"
      >
        {devices}
        {ready}
      </section>
      {side}
    </div>
  );
}

function LiveDevices({
  devices,
  consent,
  ...props
}: Props & { readonly devices: Devices; readonly consent: Consent }) {
  const snapshot = useSyncExternalStore(
    devices.subscribe,
    devices.readSnapshot,
    devices.readSnapshot,
  );
  const local = useSyncExternalStore(
    consent.subscribe,
    consent.readSnapshot,
    consent.readSnapshot,
  );
  useEffect(() => {
    consent.updateView(props.view);
  }, [consent, props.view]);
  const [inputs, setInputs] = useState<readonly MediaDeviceInfo[]>([]);
  const check = async (kind: DeviceKind) => {
    await devices.check(kind);
    try {
      setInputs(await navigator.mediaDevices.enumerateDevices());
    } catch {
      setInputs([]);
    }
  };
  const own = props.view.participants
    .filter(isNamedSeat)
    .find((seat) => seat.actorId === props.actorId);
  return (
    <GatheringLayout
      props={props}
      view={local.view}
      action={createLocalCommandAction(consent, props.action)}
      local={{
        devicesPassed: snapshot.devicesPassed,
        unreadyPending: local.pending,
      }}
      devices={
        <>
          <CameraPreview
            devices={devices}
            snapshot={snapshot}
            label={own?.label ?? ''}
          />
          <div className="grid grid-cols-2 gap-3 max-tiny:grid-cols-1">
            {(['microphone', 'camera'] as const).map((kind) => (
              <DeviceChoice
                key={kind}
                kind={kind}
                devices={devices}
                snapshot={snapshot}
                inputs={inputs}
                check={(next) => void check(next)}
              />
            ))}
          </div>
          {local.problem ? (
            <div role="alert" className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-live">
                We couldn’t confirm that you’re ready, so the round can’t start
                yet.
              </p>
              <button
                type="button"
                onClick={() => void consent.retry()}
                className={buttonClass('secondary')}
              >
                Try again
              </button>
            </div>
          ) : null}
        </>
      }
    />
  );
}

/** SSR remains failclosed for human devices; judge native forms need no JS. */
export function AssemblyDeviceReadiness(props: Props) {
  const own = props.view.participants
    .filter(isNamedSeat)
    .find((p) => p.actorId === props.actorId);
  const needsDevices = own?.kind === 'human' && own.role !== 'judge';
  const latest = useRef(props);
  const sync = useContext(RoomSyncContext);
  const latestSync = useRef(sync);
  useEffect(() => {
    latest.current = props;
    latestSync.current = sync;
  }, [props, sync]);
  const roomId = props.view.id;
  const actorId = props.actorId;
  const [resources, setResources] = useState<{
    devices: Devices;
    consent: Consent;
  } | null>(null);
  useEffect(() => {
    if (!needsDevices) return;
    const devices = createBrowserDeviceChecks();
    const consent = createLocalConsent({
      view: latest.current.view,
      actorId,
      nextId: systemId.next,
      read: () => latest.current.read(),
      send: async (command) => {
        const form = new FormData();
        for (const [key, value] of Object.entries(command))
          form.set(key, String(value));
        const result = await latest.current.send(form);
        // The consent answer is the room's canonical view: room sync adopts it.
        if (result.kind === 'accepted')
          latestSync.current?.accepted(result.view);
        return result;
      },
    });
    const unsubscribe = devices.subscribe((snapshot) => {
      void consent.devices(snapshot.devicesPassed);
    });
    void consent.devices(devices.readSnapshot().devicesPassed);
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setResources({ devices, consent });
    });
    return () => {
      cancelled = true;
      unsubscribe();
      consent.dispose();
      devices.dispose('departure');
    };
    // Authoritative updates flow through consent.updateView, not preview recreation.
  }, [needsDevices, actorId, roomId]);
  if (!needsDevices || !resources)
    return (
      <GatheringLayout
        props={props}
        view={props.view}
        action={props.action}
        local={{ devicesPassed: false, unreadyPending: false }}
        devices={
          needsDevices ? (
            <p className="rounded-xl bg-surface-sunken p-4 text-sm text-ink-muted">
              Camera and microphone checks require JavaScript.
            </p>
          ) : null
        }
      />
    );
  return <LiveDevices {...props} {...resources} />;
}
