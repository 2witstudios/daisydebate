import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { isLiveDebater } from '../../../../ui/debate-room/live-round';
import { RoundDocuments } from '../../../../ui/debate-room/round-documents';
import { RoundReceipt } from '../../../../ui/rooms/round-receipt/round-receipt';

import { readPersistedRound } from './actions';

export const metadata: Metadata = { title: 'Round' };
export default async function RoundPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const identity = await requireAccess(`/rounds/${id}`, searchParams);
  if (!idSchema.safeParse(id).success) notFound();
  const result = await readPersistedRound(id);
  if (result.kind === 'missing') notFound();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  if (
    identity.state === 'member' &&
    identity.principal.actorId !== null &&
    isLiveDebater(result.round, identity.principal.actorId)
  )
    redirect(`/rounds/${id}/room`);
  const ownsFiles =
    identity.state === 'member' &&
    result.round.participants.some(
      (p) => !('anonymous' in p) && p.actorId === identity.principal.actorId,
    );
  return (
    <>
      <RoundReceipt round={result.round} />
      {ownsFiles ? <RoundDocuments roundId={result.round.id} /> : null}
    </>
  );
}
