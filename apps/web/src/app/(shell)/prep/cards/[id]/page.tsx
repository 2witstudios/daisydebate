import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  cardDetailView,
  parseCardDetailQuery,
} from '../../../../../features/prep/cards/card-detail';
import {
  getCard,
  readingPace,
} from '../../../../../features/prep/cards/get-card';
import { requireAccess } from '../../../../../lib/access';
import { CardDetail } from '../../../../../ui/prep/card-detail/card-detail';
import { NotFoundPanel } from '../../../../../ui/prep/not-found/not-found-panel';

export const metadata: Metadata = { title: 'Evidence card' };

export default async function CardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  await requireAccess(`/prep/cards/${id}`, searchParams);
  const card = getCard(id);
  if (card === undefined)
    return (
      <NotFoundPanel
        what="card"
        backHref="/prep?view=cards"
        backLabel="Back to cards"
      />
    );
  const query = parseCardDetailQuery(await searchParams);
  return <CardDetail view={cardDetailView(card, query, readingPace())} />;
}
