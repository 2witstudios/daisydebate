import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { trainDestinations } from '../../../../../features/train/actions';
import { liveView } from '../../../../../features/train/live';
import {
  liveLinks,
  parseLiveQuery,
} from '../../../../../features/train/live-links';
import { opponentSpeech } from '../../../../../features/train/opponent';
import {
  parsePracticeConfig,
  practiceHref,
} from '../../../../../features/train/practice';
import { parseHubQuery } from '../../../../../features/train/query';
import { resolveSide } from '../../../../../features/train/turns';
import { requireAccess } from '../../../../../lib/access';
import { PracticeLive } from '../../../../../ui/train/practice-live/practice-live';

export const metadata: Metadata = { title: 'Practice' };

/** The random side is decided here, at the edge, with OS entropy. */
const coin = (): boolean =>
  (crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) % 2 === 0;

export default async function PracticeLivePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/train/practice/live', searchParams);
  const params = await searchParams;
  const config = parsePracticeConfig(params);
  const plan = parseHubQuery(params);
  const query = parseLiveQuery(params);
  const turn = { turn: String(query.seq) };
  if (config.side === 'random')
    redirect(
      practiceHref(
        trainDestinations.practiceLive,
        { ...config, side: resolveSide(config, coin()) },
        plan,
        turn,
      ),
    );
  const view = liveView(
    config,
    resolveSide(config, true),
    query.seq,
    opponentSpeech,
  );
  if (view === null) notFound();
  if (view.kind === 'unavailable')
    redirect(
      practiceHref(trainDestinations.practiceUnavailable, config, plan, {
        turn: String(view.turn.seq),
      }),
    );
  return (
    <PracticeLive
      view={view}
      links={liveLinks(config, plan, view, query)}
      query={query}
    />
  );
}
