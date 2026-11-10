import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { idSchema, roomRefusalSchema, type RoomRefusal } from '@daisy/protocol';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { roomCommandIds } from '../../../../features/rooms/room-command-ids';
import { roomWatchHref } from '../../../../features/watch/routes';
import { requireAccess } from '../../../../lib/access';
import {
  requestIdentity,
  requestWatchableRoundOfRoom,
} from '../../../../lib/request-session';
import { RoomLive } from '../../../../ui/rooms/room-page/room-live';
import { roomTemplates } from '../../play/actions';
import {
  roomAssembly,
  roomConsentIntent,
  signContentWaiverAction,
  roomCommandAction,
  submitRoomFormAction,
  saveRoomSettingsAction,
  roomInvitationAction,
} from './actions';
import { MediaDocument } from '../../../../ui/round-media/media-document';

export const metadata: Metadata = { title: 'Room' };

/**
 * Renders the room once per navigation. After hydration room sync keeps it
 * current from the room resource and its doorbell, never by re-rendering
 * this route (ADR 0066).
 */
export default async function RoomRoute({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  // Watching needs no account: someone who cannot enter the Room still reaches
  // its released Round. A member's own read below says the same (WATCH-6).
  if (
    idSchema.safeParse(id).success &&
    (await requestIdentity()).state !== 'member'
  ) {
    const watch = roomWatchHref(await requestWatchableRoundOfRoom(id));
    if (watch) redirect(watch);
  }
  const identity = await requireAccess(`/rooms/${id}`, searchParams);
  if (!idSchema.safeParse(id).success) notFound();
  if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
  const [result, catalog] = await Promise.all([
    roomAssembly(id),
    roomTemplates(),
  ]);
  if (result.kind === 'missing') notFound();
  if (result.kind !== 'found' || catalog.kind !== 'found')
    throw createAppError('INFRASTRUCTURE');
  const view = result.view;
  const watch = roomWatchHref(view.watchRoundId);
  if (watch) redirect(watch);
  return (
    <div className="room-page mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8 max-narrow:px-4">
      <MediaDocument />
      <RoomLive
        view={view}
        ids={roomCommandIds(view, () => systemId.next())}
        actorId={identity.principal.actorId}
        viewerLabel={identity.username}
        bots={catalog.bots}
        choices={catalog.choices}
        socketUrl={result.socketUrl}
        refusal={refusalOf(await searchParams)}
        commandAction={roomCommandAction.bind(null, id)}
        waiverAction={signContentWaiverAction.bind(null, id)}
        detailsAction={submitRoomFormAction.bind(null, id)}
        settingsAction={saveRoomSettingsAction.bind(null, id)}
        read={roomAssembly.bind(null, id)}
        send={roomConsentIntent.bind(null, id)}
        invitationAction={roomInvitationAction.bind(null, id)}
      />
    </div>
  );
}

/** The refusal a native post returned with: a closed vocabulary, never echoed text. */
function refusalOf(
  params: SearchParams,
): { readonly reason: RoomRefusal | null } | null {
  if (params.notice !== 'command-refused') return null;
  const reason = roomRefusalSchema.safeParse(params.reason);
  return { reason: reason.success ? reason.data : null };
}
