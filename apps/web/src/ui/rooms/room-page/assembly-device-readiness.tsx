'use client';

import { useDeliver } from '../../edge/use-answer';
import { useResource } from '../../edge/use-driver';
import { useLatest } from '../../edge/use-latest';
import { Announcement } from '../../components/announcement/announcement';
import { Button } from '../../components/button/button';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';

import {
  useContext,
  useState,
  useSyncExternalStore,
  useMemo,
  type ReactNode,
} from 'react';
import { systemId } from '@daisy/clock';
import { isJudgeSeat } from '@daisy/protocol/seats';
import { type RoomView } from '@daisy/protocol/room-contract';
import { createLocalConsent } from '../../../features/rooms/local-consent';
import {
  browserDeviceEdge,
  createBrowserDeviceChecks,
} from '../../round-media/browser-device-checks';
import { browserScheduler } from '../../edge/browser-time';
import { rememberCheckedDevices } from '../../../features/video/device-selection';
import type { DeviceKind } from '../../../features/video/device-check-controller';
import type { RoomRead } from '../../../features/rooms/read-assembly';
import type { submitAssembly } from '../../../features/rooms/submit-assembly';
import { StartControl, ReadyControl } from './assembly-readiness';
import { createLocalCommandAction } from '../../../features/rooms/local-command-action';
import { ownSeat, type LocalReadiness } from './assembly-controls';
import { CameraPreview, DeviceChoice } from './device-check';
import { RoomSyncContext } from './room-sync-context';

type Props = {
  /** The roster, given the Start line that ends it. */
  readonly main: (start: ReactNode) => ReactNode;
  /** Room controls and the settings preview, under the viewer's own tile. */
  readonly aside: ReactNode;
  /** The Room chat, under the roster; null when the viewer has none. */
  readonly chat: ReactNode;
  readonly view: RoomView;
  readonly actorId: string;
  readonly action: FormAction<RoomFormState>;
  readonly waiverAction: FormAction<RoomFormState>;
  readonly send: (form: FormData) => ReturnType<typeof submitAssembly>;
  readonly read: () => Promise<RoomRead>;
  readonly commandIds: Parameters<typeof ReadyControl>[0]['commandIds'];
};
type Devices = ReturnType<typeof createBrowserDeviceChecks>;
type Consent = ReturnType<typeof createLocalConsent>;
type DeviceResources = { readonly devices: Devices; readonly consent: Consent };
const noSubscription = () => () => {};
const noSnapshot = () => null;

function GatheringLayout({
  props,
  view,
  action,
  local,
  devices,
  turnOnDevices,
}: {
  readonly props: Props;
  readonly view: RoomView;
  readonly action: FormAction<RoomFormState>;
  readonly local: LocalReadiness;
  readonly devices: ReactNode;
  readonly turnOnDevices?: () => void;
}) {
  const controls = { ...props, view, action, local, turnOnDevices };
  const ready = ReadyControl(controls);
  return (
    <div className="grid room-gathering gap-6">
      <div className="room-main">
        <div className="order-1 min-w-0">
          {props.main(StartControl(controls))}
        </div>
        {props.chat ? (
          // The thread scrolls inside this box: it takes the column's spare
          // height and never stretches the page by its own length.
          <div className="relative order-3 min-h-room-chat flex-1">
            <div className="absolute inset-0 flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
              {props.chat}
            </div>
          </div>
        ) : null}
      </div>
      <div className="room-side">
        {devices || ready ? (
          <section
            aria-label="You"
            className="order-2 flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-3"
          >
            {devices}
            {ready}
          </section>
        ) : null}
        <div className="order-4 flex min-w-0 flex-col gap-4">{props.aside}</div>
      </div>
    </div>
  );
}

function GatheringWithDevices({
  resources,
  needsDevices,
  ...props
}: Props & {
  readonly resources: DeviceResources | null;
  readonly needsDevices: boolean;
}) {
  const devices = resources?.devices;
  const consent = resources?.consent;
  const snapshot = useSyncExternalStore<ReturnType<
    Devices['readSnapshot']
  > | null>(
    devices?.subscribe ?? noSubscription,
    devices?.readSnapshot ?? noSnapshot,
    noSnapshot,
  );
  const local = useSyncExternalStore<ReturnType<
    Consent['readSnapshot']
  > | null>(
    consent?.subscribe ?? noSubscription,
    consent?.readSnapshot ?? noSnapshot,
    noSnapshot,
  );
  const viewed = useMemo(
    () => ({ consent, view: props.view }),
    [consent, props.view],
  );
  useDeliver(viewed, (shown) => shown.consent?.updateView(shown.view));
  const [inputs, setInputs] = useState<readonly MediaDeviceInfo[]>([]);
  // Each check runs on its own stream, so both can start from one gesture;
  // the input list is read once after them.
  const check = async (...kinds: readonly DeviceKind[]) => {
    if (!devices) return;
    await Promise.all(kinds.map((kind) => devices.check(kind)));
    try {
      setInputs(await navigator.mediaDevices.enumerateDevices());
    } catch {
      setInputs([]);
    }
  };
  if (!devices || !consent || !snapshot || !local)
    return (
      <GatheringLayout
        props={props}
        view={props.view}
        action={props.action}
        local={{ devicesPassed: false, unreadyPending: false }}
        devices={
          needsDevices ? (
            <p className="flex aspect-room-preview items-center justify-center rounded-xl bg-surface-sunken p-4 text-center text-sm text-ink-muted">
              Checking your camera and microphone…
            </p>
          ) : null
        }
      />
    );
  const own = ownSeat(props.view, props.actorId);
  // Before the first Turn on there is nothing to pick: the tile is only the
  // preview and its button.
  const tried =
    snapshot.camera.status !== 'unchecked' ||
    snapshot.microphone.status !== 'unchecked' ||
    inputs.length > 0;
  return (
    <GatheringLayout
      props={props}
      view={local.view}
      action={createLocalCommandAction(consent, props.action)}
      local={{
        devicesPassed: snapshot.devicesPassed,
        unreadyPending: local.pending,
      }}
      turnOnDevices={() => void check('microphone', 'camera')}
      devices={
        <>
          <CameraPreview
            devices={devices}
            snapshot={snapshot}
            label={own?.label ?? ''}
          />
          {tried ? (
            <div className="grid grid-cols-2 gap-2 max-tiny:grid-cols-1">
              {(['camera', 'microphone'] as const).map((kind) => (
                <DeviceChoice
                  key={kind}
                  kind={kind}
                  devices={devices}
                  snapshot={snapshot}
                  inputs={inputs}
                />
              ))}
            </div>
          ) : null}
          {local.problem ? (
            <Announcement
              as="div"
              kind="problem"
              className="flex flex-wrap items-center gap-3"
            >
              <p className="text-sm text-live">Ready didn’t go through.</p>
              <Button
                variant="secondary"
                type="button"
                onClick={() => void consent.retry()}
              >
                Try again
              </Button>
            </Announcement>
          ) : null}
        </>
      }
    />
  );
}

/** Human debaters need a device check before Ready. Judges can post directly. */
export function AssemblyDeviceReadiness(props: Props) {
  const own = ownSeat(props.view, props.actorId);
  const needsDevices = own?.kind === 'human' && !isJudgeSeat(own.seat);
  const sync = useContext(RoomSyncContext);
  const latest = useLatest({ props, sync });
  const roomId = props.view.id;
  const actorId = props.actorId;
  // Authoritative updates flow through consent.updateView, not preview recreation.
  const seat = useMemo(
    () => (needsDevices ? { actorId, roomId } : null),
    [needsDevices, actorId, roomId],
  );
  const resources = useResource(
    seat,
    (checking): (DeviceResources & { dispose: () => void }) | null => {
      if (checking === null) return null;
      const { actorId: checker, roomId: room } = checking;
      const devices = createBrowserDeviceChecks(
        browserDeviceEdge(browserScheduler),
      );
      const consent = createLocalConsent({
        view: latest().props.view,
        actorId: checker,
        nextId: systemId.next,
        read: () => latest().props.read(),
        send: async (command) => {
          const form = new FormData();
          for (const [key, value] of Object.entries(command))
            form.set(key, String(value));
          const result = await latest().props.send(form);
          // The consent answer is the room's canonical view: room sync adopts it.
          if (result.kind === 'accepted') latest().sync?.accepted(result.view);
          return result;
        },
      });
      const unsubscribe = devices.subscribe((snapshot) => {
        rememberCheckedDevices(room, snapshot, undefined, checker);
        void consent.devices(snapshot.devicesPassed);
      });
      return {
        devices,
        consent,
        dispose: () => {
          unsubscribe();
          consent.dispose();
          devices.dispose('departure');
        },
      };
    },
  );
  // The gathering and its chat keep one React owner while device resources arrive.
  return (
    <GatheringWithDevices
      key={`${roomId}:${actorId}`}
      {...props}
      needsDevices={needsDevices}
      resources={needsDevices ? resources : null}
    />
  );
}
