'use client';
import { canOfferFreshRoom } from '../../../features/room-runtime/fresh-room';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { systemId } from '@daisy/clock';
import type { RoomCastChoice, RoomView } from '@daisy/protocol';
import { systemScheduler } from '../../../features/realtime/browser-adapters';
import { browserSyncEdges } from '../../../features/resource-sync/browser';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { RoomCommandIds } from '../../../features/rooms/room-command-ids';
import type { RoomRead } from '../../../features/rooms/read-assembly';
import type { submitAssembly } from '../../../features/rooms/submit-assembly';
import {
  prepDeadline,
  presentedView,
  seedRoomSync,
} from '../../../features/rooms/room-sync';
import { createRoomSyncDriver } from '../../../features/rooms/room-sync-driver';
import type { FormAction } from '../../form-action/form-action';
import { FreshnessNotice } from '../../resource-sync/freshness-notice';
import { useResourceSync } from '../../resource-sync/use-resource-sync';
import { AssemblyHeader } from './assembly-header';
import { AssemblyDeviceReadiness } from './assembly-device-readiness';
import { AssemblySeats } from './assembly-seats';
import { RoomPrep } from './room-prep';
import { RoomSettings } from './room-settings';
import { RoomSyncContext } from './room-sync-context';

type Props = {
  readonly view: RoomView;
  readonly ids: RoomCommandIds;
  readonly actorId: string;
  readonly viewerLabel: string;
  readonly bots: readonly RoomCastChoice[];
  /** The realtime endpoint, or null when realtime is not configured. */
  readonly socketUrl: string | null;
  /** A native post was refused and returned here with the notice. */
  readonly refused: boolean;
  readonly commandAction: FormAction<RoomFormState>;
  readonly detailsAction: FormAction<RoomFormState>;
  readonly settingsAction: FormAction<RoomFormState>;
  readonly read: () => Promise<RoomRead>;
  readonly send: (form: FormData) => ReturnType<typeof submitAssembly>;
};

/** Re-renders each second while a prep countdown runs. */
function useNow(running: boolean, anchor: number) {
  const [now, setNow] = useState(anchor);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(systemScheduler.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return Math.max(now, anchor);
}

/**
 * The room's client owner (ADR 0066): seeded by the server render, kept
 * current by room sync, never by re-rendering the route. A failed read
 * leaves the last view on screen and every section mounted.
 */
export function RoomLive(props: Props) {
  const { view: seedView, ids: seedIds, read, socketUrl } = props;
  const start = useCallback(
    () =>
      createRoomSyncDriver({
        seed: seedRoomSync(seedView, seedIds, systemScheduler.now()),
        read,
        nextId: () => systemId.next(),
        ...browserSyncEdges(socketUrl),
      }),
    [seedView, seedIds, read, socketUrl],
  );
  const [sync, driver] = useResourceSync(
    () => seedRoomSync(seedView, seedIds, 0),
    start,
  );
  const handle = useMemo(
    () => driver && { accepted: driver.accepted, signal: driver.signal },
    [driver],
  );
  const now = useNow(prepDeadline(sync) !== null, sync.readAt);
  const view = useMemo(() => presentedView(sync, now), [sync, now]);
  const { ids } = sync.value;
  return (
    <RoomSyncContext value={handle}>
      <AssemblyHeader
        view={view}
        actorId={props.actorId}
        commandIds={ids.header}
        detailsAction={props.detailsAction}
        commandAction={props.commandAction}
      />
      <FreshnessNotice freshness={sync.freshness} noun="room" />
      {props.refused ? (
        <p role="alert">
          The command was not acknowledged. Review the current room and try
          again.
        </p>
      ) : null}
      <AssemblyDeviceReadiness
        side={
          <>
            <AssemblySeats
              view={view}
              viewer={{ actorId: props.actorId, label: props.viewerLabel }}
              bots={props.bots}
              action={props.commandAction}
              commandIds={ids.seats}
            />
            {view.definition.configurable.preRoundPrep ? (
              <RoomPrep
                view={view}
                action={props.commandAction}
                commandIds={ids.prep}
              />
            ) : null}
            <RoomSettings
              view={view}
              commandId={ids.settings}
              action={props.settingsAction}
            />
          </>
        }
        view={view}
        actorId={props.actorId}
        read={read}
        send={props.send}
        action={props.commandAction}
        commandIds={ids.readiness}
      />
      {canOfferFreshRoom(view, props.actorId) ? (
        <Link href={`/rooms/${view.id}/rematch`} className="self-start">
          Create a fresh Room
        </Link>
      ) : null}
      {view.roundRef ? (
        <Link href={`/rounds/${view.roundRef.id}`} className="self-start">
          View Round
        </Link>
      ) : null}
    </RoomSyncContext>
  );
}
