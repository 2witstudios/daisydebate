import { createAppError } from '@daisy/errors';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { getAssignedDebates } from '../../../features/judge/get-assigned';
import { requireAccess } from '../../../lib/access';
import { JudgeHub } from '../../../ui/judge/judge-hub/judge-hub';
import { readPersistedJudgeAssignments } from './actions';
export const metadata: Metadata = { title: 'Judge' };
export default async function JudgePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/judge', searchParams);
  const result = await readPersistedJudgeAssignments();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return <JudgeHub assigned={getAssignedDebates(result.assignments)} />;
}
