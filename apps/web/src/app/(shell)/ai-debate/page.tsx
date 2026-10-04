import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { botSelector, parseBotId } from '../../../features/train/bots';
import { requireAccess } from '../../../lib/access';
import { BotRoom } from '../../../ui/ai-debate/match/bot-room';
import { startAiDebateAction } from './actions';

export const metadata: Metadata = { title: 'Debate a bot' };

/** The room before a debate against the Train bot the address names. */
export default async function BotRoomPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/ai-debate', searchParams);
  const { selected } = botSelector(parseBotId(await searchParams));
  return <BotRoom bot={selected} action={startAiDebateAction} />;
}
