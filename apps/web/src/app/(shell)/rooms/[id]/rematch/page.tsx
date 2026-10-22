import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { canOfferFreshRoom } from '../../../../../features/room-runtime/fresh-room';
import { requireAccess } from '../../../../../lib/access';
import { CreateRoomPage } from '../../../../../ui/rooms/create-room/create-room-page';
import { roomTemplates } from '../../../play/actions';
import { roomAssembly } from '../actions';
import { createFreshRoomAction } from './actions';
export default async function FreshRoomPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const identity = await requireAccess(`/rooms/${id}/rematch`, searchParams);
  if (!idSchema.safeParse(id).success) notFound();
  if (identity.state !== 'member' || identity.principal.actorId === null)
    throw createAppError('AUTHORIZATION');
  const source = await roomAssembly(id);
  if (source.kind === 'missing') notFound();
  if (source.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  if (!canOfferFreshRoom(source.view, identity.principal.actorId))
    redirect(`/rooms/${id}`);
  const templates = await roomTemplates();
  if (templates.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return (
    <CreateRoomPage
      freshRoom
      action={createFreshRoomAction.bind(null, id)}
      choices={templates.choices}
      commandId={systemId.next()}
    />
  );
}
