import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { getTrainingSummary } from '../../../../features/train/get-summary';
import {
  customRulesView,
  parseCustomRulesQuery,
  ruleSetLinks,
} from '../../../../features/train/custom-rules';
import { requireAccess } from '../../../../lib/access';
import { CustomRules } from '../../../../ui/train/custom-rules/custom-rules';

export const metadata: Metadata = { title: 'Custom rules' };

export default async function CustomRulesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train/rules', searchParams);
  const query = parseCustomRulesQuery(await searchParams);
  return (
    <CustomRules
      view={customRulesView(query)}
      query={query}
      ruleSets={ruleSetLinks(getTrainingSummary().ruleSets, query.plan)}
    />
  );
}
