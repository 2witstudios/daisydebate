'use client';
import { roomWatchHref } from '../../../features/watch/routes';
import { roundEntry } from '../../../features/rooms/round-entry';
import { canOfferFreshRoom } from '../../../features/room-runtime/fresh-room';
import { roundLinkOf } from '../../../features/room-runtime/round-link';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { browserDocument } from '../../round-media/browser-document';
import { replaceRoute } from '../../round-media/replace-route';
import { systemId } from '@daisy/clock';
import type {
  RoomCastChoice,
  RoomCatalogChoice,
  RoomView,
} from '@daisy/protocol';
import { systemScheduler } from '../../../features/realtime/browser-adapters';
import { browserSyncEdges } from '../../../features/resource-sync/browser';
import {
  roomNoticeText,
  type RoomFormState,
  type RoomNotice,
} from '../../../features/rooms/command-answer';
import type { RoomCommandIds } from '../../../features/rooms/room-command-ids';
import type { RoomRead } from '../../../features/rooms/read-assembly';
import type { submitAssembly } from '../../../features/rooms/submit-assembly';
import { seedRoomSync } from '../../../features/rooms/room-sync';
import { createRoomSyncDriver } from '../../../features/rooms/room-sync-driver';
import type { FormAction } from '../../form-action/form-action';
import { FreshnessNotice } from '../../resource-sync/freshness-notice';
import { useResourceSync } from '../../resource-sync/use-resource-sync';
import { AssemblyHeader, RoomResolution } from './assembly-header';
import { RoomSetup } from './room-setup';
import { InvitedNotice } from './invited-notice';
import type { InvitationFormState } from '../../../features/room-invitations/submit';
import { AssemblyDeviceReadiness } from './assembly-device-readiness';
import { AssemblySeats } from './assembly-seats';
import { RoomSettings } from './room-settings';
import { RoomSyncContext } from './room-sync-context';
import { MediaPageLink } from '../../round-media/media-page-link';

type Props = {
  readonly view: RoomView;
  readonly ids: RoomCommandIds;
  readonly actorId: string;
  readonly viewerLabel: string;
  readonly bots: readonly RoomCastChoice[];
  /** The picker's catalog for Room setup (FMT-3). */
  readonly choices: readonly RoomCatalogChoice[];
  /** The realtime endpoint, or null when realtime is not configured. */
  readonly socketUrl: string | null;
  /** A native post was not accepted and returned here with its notice. */
  readonly notice: RoomNotice | null;
  readonly commandAction: FormAction<RoomFormState>;
  readonly waiverAction: FormAction<RoomFormState>;
  readonly detailsAction: FormAction<RoomFormState>;
  readonly settingsAction: FormAction<RoomFormState>;
  readonly read: () => Promise<RoomRead>;
  readonly send: (form: FormData) => ReturnType<typeof submitAssembly>;
  readonly invitationAction: FormAction<InvitationFormState>;
  /** The Room chat for this viewer, or null when they may not read it. */
  readonly chat: ReactNode;
};

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
  const syncedView = sync.value.view;
  // Synced in place: the page redirects on a fresh load, this covers an open tab.
  const watchHref = roomWatchHref(syncedView.watchRoundId);
  const [terminalRound, setTerminalRound] = useState<Pick<
    RoomView,
    'id' | 'roundRef'
  > | null>(() => roundEntry(seedView, props.actorId, null).terminal);
  const entry = roundEntry(syncedView, props.actorId, terminalRound);
  const roundLink = roundLinkOf(syncedView, props.actorId);
  if (entry.terminal !== terminalRound) setTerminalRound(entry.terminal);
  const view = useMemo(
    () => ({ ...syncedView, roundRef: entry.roundRef }),
    [syncedView, entry.roundRef],
  );
  const { ids } = sync.value;
  const router = useRouter();
  useEffect(() => {
    if (entry.href) replaceRoute(router, browserDocument(), entry.href);
  }, [entry.href, router]);
  return (
    <RoomSyncContext value={handle}>
      <AssemblyHeader
        view={view}
        actorId={props.actorId}
        commandIds={ids.header}
        commandAction={props.commandAction}
        invitationAction={props.invitationAction}
      />
      <InvitedNotice
        view={view}
        viewerLabel={props.viewerLabel}
        action={props.invitationAction}
      />
      {view.capabilities.canEdit ? (
        <RoomSetup
          view={view}
          choices={props.choices}
          commandIds={{
            details: ids.header.details,
            settings: ids.settings,
            capture: ids.capture,
          }}
          formatIds={ids.format}
          detailsAction={props.detailsAction}
          settingsAction={props.settingsAction}
          commandAction={props.commandAction}
        />
      ) : null}
      <RoomResolution view={view} />
      <FreshnessNotice freshness={sync.freshness} noun="room" />
      {props.notice ? <p role="alert">{roomNoticeText(props.notice)}</p> : null}
      <AssemblyDeviceReadiness
        chat={props.chat}
        side={(ready) => (
          <>
            <AssemblySeats
              ready={ready}
              view={view}
              viewer={{ actorId: props.actorId, label: props.viewerLabel }}
              bots={props.bots}
              action={props.commandAction}
              commandIds={ids.seats}
            />
            <RoomSettings view={view} />
          </>
        )}
        view={view}
        actorId={props.actorId}
        read={read}
        waiverAction={props.waiverAction}
        send={props.send}
        action={props.commandAction}
        commandIds={ids.readiness}
      />
      {canOfferFreshRoom(view, props.actorId) ? (
        <Link href={`/rooms/${view.id}/rematch`} className="self-start">
          Create a new room
        </Link>
      ) : null}
      {watchHref ? (
        <Link href={watchHref} className="self-start">
          Watch this Round
        </Link>
      ) : null}
      {roundLink ? (
        <MediaPageLink href={roundLink} className="self-start">
          View the round
        </MediaPageLink>
      ) : null}
    </RoomSyncContext>
  );
}
