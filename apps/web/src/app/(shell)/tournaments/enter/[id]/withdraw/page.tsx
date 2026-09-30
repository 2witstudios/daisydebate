import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../../features/access/decision';
import { getTournament } from '../../../../../../features/tournaments/get-tournament';
import { withdrawScreen } from '../../../../../../features/tournaments/withdraw';
import { requireAccess } from '../../../../../../lib/access';
import { WithdrawPage } from '../../../../../../ui/tournaments/withdraw/withdraw-page';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

export const metadata: Metadata = { title: 'Withdraw' };

export default async function WithdrawRoute({ params, searchParams }: Props) {
  const { id } = await params;
  await requireAccess(`/tournaments/enter/${id}/withdraw`, searchParams);
  const view = getTournament(id, true);
  if (!view) notFound();
  return (
    <WithdrawPage screen={withdrawScreen(view)} tournament={view.tournament} />
  );
}
