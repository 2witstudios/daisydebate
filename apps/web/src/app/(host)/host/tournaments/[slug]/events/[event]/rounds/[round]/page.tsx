import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readDrawBoard } from '../../../../../../../../../features/tab/draw';
import { readRunningRound } from '../../../../../../../../../features/tab/tab-round';
import { DrawBoard } from '../../../../../../../../../ui/tab/draw-board/draw-board';
import { RunningRound } from '../../../../../../../../../ui/tab/running-round/running-round';
import { hostRoutes } from '../../../../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../../../../features/tab/tournament';
import { requireGrant } from '../../../../../../require-grant';

export const metadata: Metadata = { title: 'Round' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string; event: string; round: string }>;
  readonly searchParams: Promise<{ fixture?: string | string[] }>;
}) {
  const { slug, event, round } = await params;
  const { fixture } = await searchParams;
  const scene = await requireGrant(hostRoutes.round(slug, event, round));
  const rail = readTimelineRail(slug, scene);
  if (rail === null) notFound();
  const current = `round-${round}`;
  // A tab round is a draft draw until it is published, and its Rooms after.
  const draw = readDrawBoard(
    slug,
    event,
    round,
    typeof fixture === 'string' ? fixture : null,
    scene,
  );
  if (draw !== null)
    return <DrawBoard rail={rail} current={current} draw={draw} />;
  const running = readRunningRound(slug, event, round, scene);
  if (running === null) notFound();
  return <RunningRound rail={rail} current={current} round={running} />;
}
