'use client';

import { useEffect, useState, useSyncExternalStore, useRef } from 'react';
import { systemId } from '@daisy/clock';
import type { RoomView } from '@daisy/protocol';
import { createLocalConsent } from '../../../features/rooms/local-consent';
import { createBrowserDeviceChecks } from '../../../features/video/browser-device-checks';
import type { DeviceKind } from '../../../features/video/device-check-controller';
import type { readAssembly } from '../../../features/rooms/read-assembly';
import type { submitAssembly } from '../../../features/rooms/submit-assembly';
import { AssemblyReadiness } from './assembly-readiness';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';

type Props = {
  readonly view: RoomView;
  readonly actorId: string;
  readonly action: (form: FormData) => Promise<void>;
  readonly send: (form: FormData) => ReturnType<typeof submitAssembly>;
  readonly read: () => ReturnType<typeof readAssembly>;
  readonly commandIds: Parameters<typeof AssemblyReadiness>[0]['commandIds'];
};
type Devices = ReturnType<typeof createBrowserDeviceChecks>;
type Consent = ReturnType<typeof createLocalConsent>;

function CameraPreview({
  devices,
  generation,
  status,
}: {
  readonly devices: Devices;
  readonly generation: number;
  readonly status: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (element) element.srcObject = devices.preview('camera');
    return () => {
      if (element) element.srcObject = null;
    };
  }, [devices, generation, status]);
  return (
    <video
      ref={video}
      muted
      autoPlay
      playsInline
      aria-label="Your local camera preview"
      className="w-full rounded-xl"
    />
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
  const action = async (form: FormData) => {
    const type = form.get('type');
    if (type === 'ready') {
      await consent.ready();
      return;
    }
    if (type === 'unready') {
      await consent.unready();
      return;
    }
    if (!consent.readSnapshot().pending && consent.readSnapshot().devicesPassed)
      await props.action(form);
  };
  return (
    <>
      <section
        aria-label="Local device checks"
        className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-1"
      >
        <h2 className="font-strong">Check your camera and microphone</h2>
        <p className="text-sm text-ink-muted">
          Your preview stays on this device.
        </p>
        {(['camera', 'microphone'] as const).map((kind: DeviceKind) => (
          <div key={kind} className="flex flex-col gap-2">
            <p role="status">
              {kind === 'camera' ? 'Camera' : 'Microphone'}:{' '}
              {snapshot[kind].status}
              {snapshot[kind].reason
                ? ` · ${snapshot[kind].reason.replaceAll('-', ' ')}`
                : ''}
            </p>
            <label>
              {kind === 'camera' ? 'Camera input' : 'Microphone input'}
              <select
                className={controlClass}
                value={snapshot[kind].selectedDeviceId ?? ''}
                onChange={(event) =>
                  devices.select(kind, event.target.value || null)
                }
              >
                <option value="">System default</option>
                {inputs
                  .filter(
                    (input) =>
                      input.kind ===
                      (kind === 'camera' ? 'videoinput' : 'audioinput'),
                  )
                  .map((input, index) => (
                    <option key={input.deviceId} value={input.deviceId}>
                      {input.label || `Input ${index + 1}`}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className={buttonClass('secondary')}
              onClick={() => void check(kind)}
              disabled={snapshot[kind].status === 'checking'}
            >
              Check {kind}
            </button>
          </div>
        ))}
        <CameraPreview
          devices={devices}
          generation={snapshot.camera.generation}
          status={snapshot.camera.status}
        />
        {local.problem ? (
          <div role="alert">
            <p>
              Your readiness update is not acknowledged. Launch stays blocked.
            </p>
            <button
              type="button"
              onClick={() => void consent.retry()}
              className={buttonClass('secondary')}
            >
              Retry readiness update
            </button>
          </div>
        ) : null}
      </section>
      <AssemblyReadiness
        {...props}
        view={local.view}
        action={action}
        local={{
          devicesPassed: snapshot.devicesPassed,
          unreadyPending: local.pending,
        }}
      />
    </>
  );
}

/** SSR remains failclosed for human devices; judge native forms need no JS. */
export function AssemblyDeviceReadiness(props: Props) {
  const own = props.view.participants.find((p) => p.actorId === props.actorId);
  const needsDevices = own?.kind === 'human' && own.role !== 'judge';
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
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
      send: (command) => {
        const form = new FormData();
        for (const [key, value] of Object.entries(command))
          form.set(key, String(value));
        return latest.current.send(form);
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
      <AssemblyReadiness
        {...props}
        local={{ devicesPassed: false, unreadyPending: false }}
      />
    );
  return <LiveDevices {...props} {...resources} />;
}
