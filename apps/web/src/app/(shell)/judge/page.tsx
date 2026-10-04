import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { getAssignedDebates } from '../../../features/judge/get-assigned';
import { getJudgeRating } from '../../../features/judge/get-judge-rating';
import { listJudgeResources } from '../../../features/judge/list-judge-resources';
import { requireAccess } from '../../../lib/access';
import { JudgeHub } from '../../../ui/judge/judge-hub/judge-hub';

export const metadata: Metadata = { title: 'Judge' };

export default async function JudgePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/judge', searchParams);
  return (
    <JudgeHub
      rating={getJudgeRating()}
      resources={listJudgeResources()}
      assigned={getAssignedDebates()}
    />
  );
}
