import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { parsePracticeConfig } from '../../../../features/train/practice';
import { parseHubQuery } from '../../../../features/train/query';
import { requireAccess } from '../../../../lib/access';
import { PracticeSetup } from '../../../../ui/train/practice-setup/practice-setup';

export const metadata: Metadata = { title: 'Set up a practice' };

export default async function PracticeSetupPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train/practice', searchParams);
  const params = await searchParams;
  return (
    <PracticeSetup
      config={parsePracticeConfig(params)}
      plan={parseHubQuery(params)}
    />
  );
}
