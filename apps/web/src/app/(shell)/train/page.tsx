import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { trainLanding } from '../../../features/train/bots';
import { startPracticeAction } from './actions';
import { requireAccess } from '../../../features/access/page-access';
import { roomTemplates } from '../play/actions';
import { BotSelectorPage } from '../../../ui/train/bots/bot-selector';
import { TrainComingSoon } from '../../../ui/train/coming-soon/train-coming-soon';
import { botDebatesReleasedTo } from '../../../features/train/release';

export const metadata: Metadata = { title: 'Train' };

/** Train's landing: choose a bot opponent and start a practice Room, once bot debates are released to the member. */
export default async function TrainPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/train', searchParams);
  // Unreleased, Train reads no roster and offers no practice (`bot-debates`).
  if (!(await botDebatesReleasedTo(identity))) return <TrainComingSoon />;
  const templates = await roomTemplates();
  return (
    <BotSelectorPage
      view={trainLanding(
        await searchParams,
        templates.kind === 'found' ? templates.bots : [],
        templates.kind === 'found' && templates.botDebateAiJudge,
      )}
      action={startPracticeAction}
      unavailable={templates.kind !== 'found'}
    />
  );
}
