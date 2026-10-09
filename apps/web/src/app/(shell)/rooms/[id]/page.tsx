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
import { AssemblyDetails } from '../../../../ui/rooms/room-page/assembly-details';
import { AssemblyReadiness } from '../../../../ui/rooms/room-page/assembly-readiness';
import { AssemblySettingsForm } from '../../../../ui/rooms/room-page/assembly-settings-form';
import { AssemblySeats } from '../../../../ui/rooms/room-page/assembly-seats';
import { RoomRefresher } from '../../../../ui/rooms/room-page/room-refresher';
import { roomTemplates } from '../../play/actions';
import {
  roomAssembly,
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
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8">
      <RoomRefresher />
      <header>
        <Link href="/lobby">Lobby</Link>
        <h1 className="font-display text-3xl font-bold">{view.title}</h1>
        <p>{view.topic}</p>
        <p className="text-ink-muted">
          Host: {view.hostLabel} · {view.status}
        </p>
      </header>
      {(await searchParams).notice === 'command-refused' ? (
        <p role="alert">
          The command was not acknowledged. Review the current room and try
          again.
        </p>
      ) : null}
      <AssemblyDetails
        view={view}
        commandId={systemId.next()}
        action={submitRoomFormAction.bind(null, id)}
      />
      <AssemblySettingsForm
        view={view}
        commandId={systemId.next()}
        action={saveRoomSettingsAction.bind(null, id)}
      />
      <AssemblySeats
        seats={view.definition.seats}
        participants={view.participants}
      />
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
      <AssemblyReadiness
        view={view}
        actorId={identity.principal.actorId}
        local={{ devicesPassed: false, unreadyPending: false }}
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
