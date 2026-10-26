'use client';

import { useEffect, useRef } from 'react';
import type { createBrowserDeviceChecks } from '../../../features/video/browser-device-checks';
import type { DeviceKind } from '../../../features/video/device-check-controller';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';
import { MicLevel } from './mic-level';
import { initials } from './room-labels';

type Devices = ReturnType<typeof createBrowserDeviceChecks>;
type Snapshot = ReturnType<Devices['readSnapshot']>;

type Reason = NonNullable<Snapshot['camera']['reason']>;

const kindLabel = { camera: 'Camera', microphone: 'Microphone' } as const;

const reasonLabel: Record<Reason, (kind: DeviceKind) => string> = {
  'track-ended': () => 'track ended',
  'device-disappeared': () => 'device disappeared',
  'selection-changed': () => 'selection changed',
  'permission-denied': () => "blocked by this site's settings",
  'system-denied': () => 'blocked by your system',
  'device-in-use': () => 'in use',
  'device-missing': (kind) => `no ${kind} found`,
  'no-signal': (kind) =>
    kind === 'camera'
      ? 'opened but sent no video'
      : 'opened but picked up no sound',
  'check-failed': () => 'check failed',
};

/** What the person can do about a refusal; other reasons need only a retry. */
const remedy: Partial<Record<Reason, (kind: DeviceKind) => string>> = {
  'system-denied': (kind) =>
    `Your operating system blocked the browser. On a Mac, open System Settings › Privacy & Security › ${kindLabel[kind]} and allow your browser, then reopen it.`,
  'permission-denied': (kind) =>
    `Allow the ${kind} in your browser's site settings, then reload the page.`,
  'device-in-use': (kind) =>
    `Close the other app using your ${kind}, then check again.`,
  'device-missing': (kind) =>
    `Connect a ${kind} or use Continuity Camera, then check again.`,
  'no-signal': (kind) =>
    `Make sure nothing covers or mutes your ${kind}, or choose another, then check again.`,
};

function statusText(kind: DeviceKind, state: Snapshot[DeviceKind]) {
  if (state.status === 'passed')
    return { line: `✓ ${kindLabel[kind]}`, help: null };
  const reason = state.reason;
  return {
    line: `${kindLabel[kind]}: ${state.status}${reason ? ` · ${reasonLabel[reason](kind)}` : ''}`,
    help: (reason && remedy[reason]?.(kind)) ?? null,
  };
}

export function CameraPreview({
  devices,
  snapshot,
  label,
}: {
  readonly devices: Devices;
  readonly snapshot: Snapshot;
  readonly label: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const { generation, status } = snapshot.camera;
  useEffect(() => {
    const element = video.current;
    if (element) element.srcObject = devices.preview('camera');
    return () => {
      if (element) element.srcObject = null;
    };
  }, [devices, generation, status]);
  const microphone =
    snapshot.microphone.status === 'passed'
      ? devices.preview('microphone')
      : null;
  return (
    <div className="relative flex aspect-room-preview items-center justify-center overflow-hidden rounded-xl bg-surface-stage">
      <video
        ref={video}
        muted
        autoPlay
        playsInline
        aria-label="Your local camera preview"
        className={status === 'passed' ? 'size-full object-cover' : 'sr-only'}
      />
      {status === 'passed' ? null : (
        <span
          aria-hidden="true"
          className="flex size-room-avatar items-center justify-center rounded-full bg-butter font-display text-2xl text-forest"
        >
          {initials(label)}
        </span>
      )}
      <span className="absolute right-4 bottom-4">
        <MicLevel stream={microphone} />
      </span>
    </div>
  );
}

export function DeviceChoice({
  kind,
  devices,
  snapshot,
  inputs,
  check,
}: {
  readonly kind: DeviceKind;
  readonly devices: Devices;
  readonly snapshot: Snapshot;
  readonly inputs: readonly MediaDeviceInfo[];
  readonly check: (kind: DeviceKind) => void;
}) {
  const state = snapshot[kind];
  const id = `device-${kind}`;
  const { line, help } = statusText(kind, state);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-sm text-ink-muted">
        {kindLabel[kind]}
      </label>
      <select
        id={id}
        className={controlClass}
        value={state.selectedDeviceId ?? ''}
        onChange={(event) => devices.select(kind, event.target.value || null)}
      >
        <option value="">System default</option>
        {inputs
          .filter(
            (input) =>
              input.kind === (kind === 'camera' ? 'videoinput' : 'audioinput'),
          )
          .map((input, index) => (
            <option key={input.deviceId} value={input.deviceId}>
              {input.label || `Input ${index + 1}`}
            </option>
          ))}
      </select>
      <div className="flex flex-col items-start gap-2">
        <p
          role="status"
          className={`text-sm ${state.status === 'passed' ? 'text-online' : 'text-ink-muted'}`}
        >
          {line}
        </p>
        {help ? (
          <p role="note" className="text-sm text-ink-muted">
            {help}
          </p>
        ) : null}
        {state.status === 'passed' ? null : (
          <button
            type="button"
            className={buttonClass('secondary')}
            onClick={() => check(kind)}
            disabled={state.status === 'checking'}
          >
            Check {kind}
          </button>
        )}
      </div>
    </div>
  );
}
