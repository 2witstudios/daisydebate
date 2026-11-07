import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { requireAccess } from '../../../../../lib/access';
import type { SearchParams } from '../../../../../features/access/decision';
import { FloorChat } from '../../../../../ui/round-floor/floor-chat';
import { readPersistedRound } from '../actions';
import { floorProps } from './floor-props';
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
  const props = await floorProps(
    id,
    identity.principal.actorId,
    round.socketUrl,
    round.round.status === 'completed' || round.round.status === 'abandoned',
    true,
  );
  if (!props) notFound();
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-4 p-4">
      <Link href={`/rounds/${id}`}>Back to Round</Link>
      <h1 className="text-xl font-strong">Round chat</h1>
      <FloorChat {...props} />
    </main>
  );
}
