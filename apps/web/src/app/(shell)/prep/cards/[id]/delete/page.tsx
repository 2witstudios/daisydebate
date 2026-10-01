import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../../features/access/decision';
import { getCard } from '../../../../../../features/prep/get-card';
import { requireAccess } from '../../../../../../lib/access';
import { CardDelete } from '../../../../../../ui/prep/card-detail/card-delete';
import { NotFoundPanel } from '../../../../../../ui/prep/not-found/not-found-panel';

export const metadata: Metadata = { title: 'Delete evidence card' };

export default async function DeleteCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  await requireAccess(`/prep/cards/${id}/delete`, searchParams);
  const card = getCard(id);
  if (card === undefined)
    return (
      <NotFoundPanel
        what="card"
        backHref="/prep?view=cards"
        backLabel="Back to cards"
      />
    );
  return <CardDelete card={card} />;
}
