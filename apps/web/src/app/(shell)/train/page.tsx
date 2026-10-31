import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { trainLanding } from '../../../features/train/bots';
import { startPracticeAction } from './actions';
import { requireAccess } from '../../../lib/access';
import { roomTemplates } from '../play/actions';
import { BotSelectorPage } from '../../../ui/train/bots/bot-selector';

export const metadata: Metadata = { title: 'Train' };

/** Train's landing: choose a bot opponent and start a practice Room. */
export default async function TrainPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train', searchParams);
  const templates = await roomTemplates();
  return (
    <BotSelectorPage
      view={trainLanding(
        await searchParams,
        templates.kind === 'found' ? templates.bots : [],
      )}
      action={startPracticeAction}
      unavailable={templates.kind !== 'found'}
    />
  );
}
