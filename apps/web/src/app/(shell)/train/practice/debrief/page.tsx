import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  debriefView,
  parseDebriefQuery,
} from '../../../../../features/train/debrief';
import { parsePracticeConfig } from '../../../../../features/train/practice';
import { parseHubQuery } from '../../../../../features/train/query';
import { resolveSide } from '../../../../../features/train/turns';
import { requireAccess } from '../../../../../lib/access';
import { Debrief } from '../../../../../ui/train/debrief/debrief';

export const metadata: Metadata = { title: 'Practice debrief' };

export default async function PracticeDebriefPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train/practice/debrief', searchParams);
  const params = await searchParams;
  const config = parsePracticeConfig(params);
  const query = parseDebriefQuery(params);
  return (
    <Debrief
      view={debriefView(config, resolveSide(config, true), query)}
      config={config}
      plan={parseHubQuery(params)}
      query={query}
    />
  );
}
