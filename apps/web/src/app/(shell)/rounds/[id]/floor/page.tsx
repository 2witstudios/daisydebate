import { notFound } from 'next/navigation';
import { MediaPageLink } from '../../../../../ui/round-media/media-page-link';
import { createAppError } from '@daisy/errors';
import { isRoundOver } from '@daisy/protocol/round';
import { idSchema } from '@daisy/protocol/primitives';
import { requireAccess } from '../../../../../features/access/page-access';
import type { SearchParams } from '../../../../../features/access/decision';
import { FloorChat } from '../../../../../ui/round-floor/floor-chat';
import { readPersistedRound } from '../actions';
import { readFloorProps } from './floor-props';
import { temporarilyRefused } from '../../../../../features/resource-sync/temporary-read';
import { reconnectingRoundPage } from '../../../../../ui/debate-room/round-reconnecting';
export const metadata = { title: 'Round chat' };
export default async function RoundFloorPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const identity = await requireAccess(`/rounds/${id}/floor`, searchParams);
  if (!idSchema.safeParse(id).success || identity.state !== 'member')
    notFound();
  const round = await readPersistedRound(id);
  if (round.kind === 'missing') notFound();
  if (round.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  const floor = await readFloorProps(
    id,
    identity.principal.actorId,
    round.socketUrl,
    isRoundOver(round.round.status),
  );
  if (floor.kind === 'missing') notFound();
  if (temporarilyRefused(floor)) return reconnectingRoundPage();
  if (floor.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-4 p-4">
      <MediaPageLink href={`/rounds/${id}`}>Back to Round</MediaPageLink>
      <h1 className="text-xl font-strong">Round chat</h1>
      <FloorChat {...floor.props} retryDiscovery />
    </main>
  );
}
