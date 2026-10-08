import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  cardCreateView,
  parseCardCreateQuery,
} from '../../../../../features/prep/cards/card-create';
import { readingPace } from '../../../../../features/prep/cards/get-card';
import { requireAccess } from '../../../../../lib/access';
import { CardCreate } from '../../../../../ui/prep/card-create/card-create';

export const metadata: Metadata = { title: 'New evidence card' };

export default async function NewCardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/prep/cards/new', searchParams);
  const query = parseCardCreateQuery(await searchParams);
  return <CardCreate view={cardCreateView(query, readingPace())} />;
}
