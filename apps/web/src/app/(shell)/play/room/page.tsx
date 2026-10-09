import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { CreateRoomPage } from '../../../../ui/rooms/create-room/create-room-page';
import { createRoomAction, roomTemplates } from '../actions';

export const metadata: Metadata = { title: 'Create a room' };

export default async function OpenRoomPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/play/room', searchParams);
  const templates = await roomTemplates();
  if (templates.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return (
    <CreateRoomPage
      action={createRoomAction}
      choices={templates.choices}
      commandId={systemId.next()}
    />
  );
}
