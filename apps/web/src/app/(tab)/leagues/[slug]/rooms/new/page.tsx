import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createId } from '@paralleldrive/cuid2';
import { requestStandingRoomPage } from '../../../../../../features/tab/page-reads';
import { requireAccess } from '../../../../../../features/access/page-access';
import { tabRoutes } from '../../../../../../features/tab/routes';
import { standingRoomCreationSchema } from '../../../../../../features/tab/standing-room-creation';
import { standingRoomContext } from '../../../../../../features/tab/standing-room-form';
import { standingRoomView } from '../../../../../../features/tab/standing-room-view';
import { StoredCreateRoom } from '../../../../../../ui/tab/league-lobby/stored-create-room';
import { standingRoomCreateAction } from './actions';
export const metadata: Metadata = { title: 'New room' };
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ template?: string }>;
}) {
  const { slug } = await params;
  await requireAccess(tabRoutes.newLeagueRoom(slug), searchParams);
  const query = await searchParams;
  const read = await requestStandingRoomPage(slug, query.template);
  if (!read) notFound();
  const creation = standingRoomCreationSchema.safeParse(read.creation);
  if (!creation.success) notFound();
  const view = standingRoomView(read, creation.data, read.lobby.handle);
  if (!view || read.draft.at.kind !== 'room_draft') notFound();
  const context = standingRoomContext({
    commandId: createId(),
    lobbyId: read.draft.at.lobbyId,
    templateId: view.templateId,
    creation: creation.data,
  });
  return (
    <StoredCreateRoom
      key={view.templateId}
      view={view}
      action={standingRoomCreateAction.bind(null, context)}
    />
  );
}
