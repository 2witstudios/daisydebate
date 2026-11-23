'use client';

import { useResource } from '../../edge/use-driver';
import { StatusRegion } from '../../components/status-region/status-region';
import { useMemo, useRef } from 'react';
import type { createBrowserDeviceChecks } from '../../round-media/browser-device-checks';
import type { DeviceKind } from '../../../features/video/device-check-controller';
import { Icon } from '../../components/icon/icon';
import { MicLevel } from './mic-level';
import { initialsOf } from '../../../lib/initials';

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
    `Close the other app using your ${kind}, then try again.`,
  'device-missing': (kind) =>
    `Connect a ${kind} or use Continuity Camera, then try again.`,
  'no-signal': (kind) =>
    `Make sure nothing covers or mutes your ${kind}, or choose another, then try again.`,
};

const statusLabel: Readonly<
  Record<Exclude<Snapshot[DeviceKind]['status'], 'passed'>, string>
> = {
  unchecked: 'not checked yet',
  checking: 'checking…',
  denied: 'blocked',
  unavailable: 'can’t be used',
};

/** The state beside the device's name: the reason when there is one, else the state in words. */
function statusText(kind: DeviceKind, state: Snapshot[DeviceKind]) {
  if (state.status === 'passed') return { words: '✓ checked', help: null };
  const reason = state.reason;
  return {
    words: reason ? reasonLabel[reason](kind) : statusLabel[state.status],
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
  // Each new camera generation or status is a new preview on the element.
  const preview = useMemo(
    () => ({ devices, generation, status }),
    [devices, generation, status],
  );
  useResource(preview, (shown) => {
    const element = video.current;
    if (element) element.srcObject = shown.devices.preview('camera');
    return {
      dispose: () => {
        if (element) element.srcObject = null;
      },
    };
  });
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
          {initialsOf(label)}
        </span>
      )}
      <span className="absolute right-4 bottom-4">
        <MicLevel stream={microphone} />
      </span>
    </div>
  );
}

/** A device's picker under the preview: its icon and choice, and what to do only when it failed. */
export function DeviceChoice({
  kind,
  devices,
  snapshot,
  inputs,
}: {
  readonly kind: DeviceKind;
  readonly devices: Devices;
  readonly snapshot: Snapshot;
  readonly inputs: readonly MediaDeviceInfo[];
}) {
  const state = snapshot[kind];
  const failed = state.status === 'denied' || state.status === 'unavailable';
  const { words, help } = statusText(kind, state);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="flex min-w-0 items-center gap-2 rounded-sm bg-surface-sunken px-3">
        <Icon
          name={kind === 'camera' ? 'camera' : 'mic'}
          size={16}
          className={failed ? 'shrink-0 text-live' : 'shrink-0 text-ink-muted'}
        />
        <span className="sr-only">{kindLabel[kind]}</span>
        <select
          className="min-h-room-target min-w-0 flex-1 bg-transparent text-sm"
          value={state.selectedDeviceId ?? ''}
          onChange={(event) => devices.select(kind, event.target.value || null)}
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
      {failed ? (
        <StatusRegion as="p" role="alert" className="text-sm text-live">
          {`${kindLabel[kind]}: ${words}.`}
          {help ? ` ${help}` : null}
        </StatusRegion>
      ) : null}
    </div>
  );
}
