import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { trainDestinations } from '../../../../../features/train/actions';
import { liveView } from '../../../../../features/train/live';
import {
  parseLiveQuery,
  unavailableLinks,
} from '../../../../../features/train/live-links';
import {
  parsePracticeConfig,
  practiceHref,
} from '../../../../../features/train/practice';
import { parseHubQuery } from '../../../../../features/train/query';
import {
  buildTurns,
  opponentTurnAt,
  resolveSide,
} from '../../../../../features/train/turns';
import { requireAccess } from '../../../../../lib/access';
import { PracticeUnavailable } from '../../../../../ui/train/practice-unavailable/practice-unavailable';

export const metadata: Metadata = { title: 'Opponent unavailable' };

export default async function PracticeUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train/practice/unavailable', searchParams);
  const params = await searchParams;
  const config = parsePracticeConfig(params);
  const plan = parseHubQuery(params);
  const { seq } = parseLiveQuery(params);
  const side = resolveSide(config, true);
  // The screen shows what a failed opponent leaves. With no opponent turn to
  // report (solo, or driving both sides) there is nothing to show: go back.
  const failed = opponentTurnAt(buildTurns(config, side), seq);
  if (failed === null)
    redirect(practiceHref(trainDestinations.practiceLive, config, plan));
  const view = liveView(config, side, failed.seq, () => ({ ok: false }));
  if (view?.kind !== 'unavailable') notFound();
  return (
    <PracticeUnavailable
      view={view}
      links={unavailableLinks(config, plan, view.turn.seq)}
    />
  );
}
