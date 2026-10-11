import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { AssemblyCast } from '../../../../ui/rooms/room-page/assembly-cast';
import { declaredSeats } from '../../../../ui/rooms/room-page/assembly-controls';
import { AssemblyHeader } from '../../../../ui/rooms/room-page/assembly-header';
import { AssemblyDeviceReadiness } from '../../../../ui/rooms/room-page/assembly-device-readiness';
import { AssemblySettingsPanel } from '../../../../ui/rooms/room-page/assembly-settings-panel';
import { AssemblySeats } from '../../../../ui/rooms/room-page/assembly-seats';
import { AssemblySchedule } from '../../../../ui/rooms/room-page/assembly-preview';
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
  return (
    <div className="room-page mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8 max-narrow:px-4">
      <RoomRefresher />
      <AssemblyHeader
        view={view}
        commandId={systemId.next()}
        action={submitRoomFormAction.bind(null, id)}
      />
      {(await searchParams).notice === 'command-refused' ? (
        <p role="alert">
          The command was not acknowledged. Review the current room and try
          again.
        </p>
      ) : null}
      <AssemblyDeviceReadiness
        lineup={
          <div className="flex min-w-0 flex-col gap-6">
            <AssemblySeats
              seats={view.definition.seats}
              participants={view.participants}
              status={view.status}
            />
            <details className="rounded-lg border border-border px-4 py-3">
              <summary className="cursor-pointer text-sm font-strong">
                {view.capabilities.host ? 'Manage seats' : 'Choose your place'}
              </summary>
              <div className="mt-4">
                <AssemblyCast
                  view={view}
                  viewer={{
                    actorId: identity.principal.actorId,
                    label: identity.username,
                  }}
                  bots={catalog.bots}
                  action={action}
                  commandIds={declaredSeats(view.definition.seats).map(() => ({
                    claim: systemId.next(),
                    assign: systemId.next(),
                    remove: systemId.next(),
                  }))}
                  leaveId={systemId.next()}
                />
              </div>
            </details>
            <AssemblySchedule view={view} />
          </div>
        }
        settings={
          <AssemblySettingsPanel
            view={view}
            commandId={systemId.next()}
            action={saveRoomSettingsAction.bind(null, id)}
          />
        }
        view={view}
        actorId={identity.principal.actorId}
        read={roomAssembly.bind(null, id)}
        send={roomConsentIntent.bind(null, id)}
        action={action}
        commandIds={{
          ready: systemId.next(),
          unready: systemId.next(),
          'start-round': systemId.next(),
          'start-prep': systemId.next(),
          'finish-prep': systemId.next(),
        }}
      />

      {view.roundRef ? (
        <Link href={`/rounds/${view.roundRef.id}`}>View persisted Round</Link>
      ) : null}
    </div>
  );
}
