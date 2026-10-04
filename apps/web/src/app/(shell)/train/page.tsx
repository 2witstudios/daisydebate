import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { botSelector, parseBotId } from '../../../features/train/bots';
import { requireAccess } from '../../../lib/access';
import { BotSelectorPage } from '../../../ui/train/bots/bot-selector';

export const metadata: Metadata = { title: 'Train' };

/** Train's landing: choose a bot opponent to debate. */
export default async function TrainPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train', searchParams);
  return <BotSelectorPage view={botSelector(parseBotId(await searchParams))} />;
}
