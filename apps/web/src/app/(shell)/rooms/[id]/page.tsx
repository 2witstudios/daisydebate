import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { roomCommandIds } from '../../../../features/rooms/room-command-ids';
import { requireAccess } from '../../../../lib/access';
import { RoomLive } from '../../../../ui/rooms/room-page/room-live';
import { roomTemplates } from '../../play/actions';
import {
  roomAssembly,
  roomConsentIntent,
  roomCommandAction,
  submitRoomFormAction,
  saveRoomSettingsAction,
} from './actions';

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
  const identity = await requireAccess(`/rooms/${id}`, searchParams);
  if (!idSchema.safeParse(id).success) notFound();
  if (identity.state !== 'member' || identity.principal.actorId === null)
    throw createAppError('AUTHORIZATION');
  const [result, catalog] = await Promise.all([
    roomAssembly(id),
    roomTemplates(),
  ]);
  if (result.kind === 'missing') notFound();
  if (result.kind !== 'found' || catalog.kind !== 'found')
    throw createAppError('INFRASTRUCTURE');
  const view = result.view;
  return (
    <div className="room-page mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8 max-narrow:px-4">
      <RoomLive
        view={view}
        ids={roomCommandIds(view, () => systemId.next())}
        actorId={identity.principal.actorId}
        viewerLabel={identity.username}
        bots={catalog.bots}
        socketUrl={result.socketUrl}
        refused={(await searchParams).notice === 'command-refused'}
        commandAction={roomCommandAction.bind(null, id)}
        detailsAction={submitRoomFormAction.bind(null, id)}
        settingsAction={saveRoomSettingsAction.bind(null, id)}
        read={roomAssembly.bind(null, id)}
        send={roomConsentIntent.bind(null, id)}
      />
    </div>
  );
}
