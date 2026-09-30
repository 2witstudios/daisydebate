import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import { parseWizardQuery } from '../../../../../features/tournaments/create-wizard';
import { getDraft } from '../../../../../features/tournaments/get-draft';
import { requireAccess } from '../../../../../lib/access';
import { CreatePage } from '../../../../../ui/tournaments/organize/create-page';

export const metadata: Metadata = { title: 'Create a tournament' };

export default async function CreateRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/tournaments/organize/new', searchParams);
  return (
    <CreatePage
      query={parseWizardQuery(await searchParams)}
      draft={getDraft()}
    />
  );
}
