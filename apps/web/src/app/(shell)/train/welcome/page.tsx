import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { parseWelcomeGoal } from '../../../../features/train/query';
import { requireAccess } from '../../../../lib/access';
import { TrainWelcome } from '../../../../ui/train/welcome/welcome';

export const metadata: Metadata = { title: 'Start training' };

export default async function TrainWelcomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train/welcome', searchParams);
  return <TrainWelcome goal={parseWelcomeGoal(await searchParams)} />;
}
