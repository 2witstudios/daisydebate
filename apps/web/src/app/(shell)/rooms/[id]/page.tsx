import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { declaredSeats } from '../../../../ui/rooms/room-page/assembly-controls';
import { AssemblyHeader } from '../../../../ui/rooms/room-page/assembly-header';
import { AssemblyDeviceReadiness } from '../../../../ui/rooms/room-page/assembly-device-readiness';
import { AssemblySeats } from '../../../../ui/rooms/room-page/assembly-seats';
import { RoomPrep } from '../../../../ui/rooms/room-page/room-prep';
import { RoomSettings } from '../../../../ui/rooms/room-page/room-settings';
import { RoomRefresher } from '../../../../ui/rooms/room-page/room-refresher';
import { roomTemplates } from '../../play/actions';
import {
  roomAssembly,
  roomConsentIntent,
  roomCommandAction,
  submitRoomFormAction,
  saveRoomSettingsAction,
} from './actions';

export const metadata: Metadata = { title: 'Room' };
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
  const action = roomCommandAction.bind(null, id);
  const actorId = identity.principal.actorId;
  return (
    <div className="room-page mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8 max-narrow:px-4">
      <RoomRefresher />
      <AssemblyHeader
        view={view}
        actorId={actorId}
        commandIds={{ details: systemId.next(), leave: systemId.next() }}
        detailsAction={submitRoomFormAction.bind(null, id)}
        commandAction={action}
      />
      {(await searchParams).notice === 'command-refused' ? (
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
              viewer={{ actorId, label: identity.username }}
              bots={catalog.bots}
              action={action}
              commandIds={declaredSeats(view.definition.seats).map(() => ({
                claim: systemId.next(),
                assign: systemId.next(),
                remove: systemId.next(),
                ai: systemId.next(),
              }))}
            />
            {view.definition.configurable.preRoundPrep ? (
              <RoomPrep
                view={view}
                action={action}
                commandIds={{
                  start: systemId.next(),
                  finish: systemId.next(),
                }}
              />
            ) : null}
            <RoomSettings
              view={view}
              commandId={systemId.next()}
              action={saveRoomSettingsAction.bind(null, id)}
            />
          </>
        }
        view={view}
        actorId={actorId}
        read={roomAssembly.bind(null, id)}
        send={roomConsentIntent.bind(null, id)}
        action={action}
        commandIds={{
          ready: systemId.next(),
          unready: systemId.next(),
          'start-round': systemId.next(),
        }}
      />
      {view.roundRef ? (
        <Link href={`/rounds/${view.roundRef.id}`} className="self-start">
          View Round
        </Link>
      ) : null}
    </div>
  );
}
