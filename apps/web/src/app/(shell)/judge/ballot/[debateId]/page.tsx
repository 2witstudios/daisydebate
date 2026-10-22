import { systemId } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { requireAccess } from '../../../../../lib/access';
import { BallotPage } from '../../../../../ui/judge/ballot-page/ballot-page';
import { readPersistedBallot, submitBallotAction } from './actions';
export const metadata: Metadata = { title: 'Your ballot' };
export default async function BallotRoute({
  params,
  searchParams,
}: {
  params: Promise<{ debateId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { debateId } = await params;
  await requireAccess(`/judge/ballot/${debateId}`, searchParams);
  const result = await readPersistedBallot(debateId);
  if (result.kind === 'missing') notFound();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  if (!result.view.own) notFound();
  return (
    <BallotPage
      view={result.view}
      commandId={systemId.next()}
      action={submitBallotAction.bind(null, debateId)}
    />
  );
}
