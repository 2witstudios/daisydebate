import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { AiDebateStartForm } from '../../../ui/ai-debate/start/start-form';
import { startAiDebateAction } from './actions';

export const metadata: Metadata = { title: 'Debate the AI' };

export default async function AiDebateStartPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/ai-debate', searchParams);
  return <AiDebateStartForm action={startAiDebateAction} />;
}
