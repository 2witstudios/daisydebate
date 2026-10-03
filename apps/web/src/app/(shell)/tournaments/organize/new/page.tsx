import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  applyEdits,
  parseEdits,
  parseWizardQuery,
} from '../../../../../features/tournaments/create-wizard';
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
  const params = await searchParams;
  const edits = parseEdits(params);
  return (
    <CreatePage
      query={parseWizardQuery(params)}
      draft={applyEdits(getDraft(), edits)}
      edits={edits}
    />
  );
}
