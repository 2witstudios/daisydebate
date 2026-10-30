import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { CreateRoomPage } from '../../../../ui/rooms/create-room/create-room-page';
import { roomTemplates } from '../actions';
import { requestRoomDraftAnswer } from '../../../../lib/request-session';

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
      initialRated={(await searchParams).rated === '1'}
      initialState={await requestRoomDraftAnswer((await searchParams).draft)}
      choices={templates.choices}
      resolutions={templates.resolutions}
      commandId={systemId.next()}
    />
  );
}
