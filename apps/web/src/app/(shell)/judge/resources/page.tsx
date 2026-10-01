import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { listJudgeResources } from '../../../../features/judge/list-judge-resources';
import { judgeRoutes } from '../../../../features/judge/routes';
import { requireAccess } from '../../../../lib/access';
import { ResourcesPage } from '../../../../ui/judge/resources-page/resources-page';

export const metadata: Metadata = { title: 'Judging resources' };

export default async function JudgeResourcesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(judgeRoutes.resources, searchParams);
  return <ResourcesPage resources={listJudgeResources()} />;
}
