import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  cardCreateView,
  parseCardCreateQuery,
} from '../../../../../features/prep/cards/card-create';
import { requireAccess } from '../../../../../lib/access';
import { CardCreate } from '../../../../../ui/prep/card-create/card-create';
import { samplePrepSource } from '../../../../../ui/mock/prep-source';

export const metadata: Metadata = { title: 'New evidence card' };

export default async function NewCardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/prep/cards/new', searchParams);
  const query = parseCardCreateQuery(await searchParams);
  return (
    <CardCreate
      view={cardCreateView(
        samplePrepSource,
        query,
        samplePrepSource.readingPace,
      )}
    />
  );
}
