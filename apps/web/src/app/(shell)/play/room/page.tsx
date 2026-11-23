import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { CreateRoomPage } from '../../../../ui/rooms/create-room/create-room-page';
import { roomTemplates } from '../actions';
import { requestMemberDivision } from '../../../../features/ratings/page-reads';
import {
  requestRoomDraftAnswer,
  requestRoomCreateLobbyChoice,
} from '../../../../features/rooms/page-reads';

export const metadata: Metadata = { title: 'Create a room' };

export default async function OpenRoomPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/play/room', searchParams);
  const query = await searchParams;
  const templates = await roomTemplates();
  if (templates.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  const draft = await requestRoomDraftAnswer(query.draft);
  const lobbyId =
    draft.values.lobby ??
    (typeof query.lobby === 'string' ? query.lobby : undefined);
  return (
    <CreateRoomPage
      initialRanked={query.ranked === '1'}
      memberDivision={await requestMemberDivision()}
      lobbyChoice={await requestRoomCreateLobbyChoice(lobbyId)}
      initialState={draft}
      choices={templates.choices}
      commandId={systemId.next()}
    />
  );
}
