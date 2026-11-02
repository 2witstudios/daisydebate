import type { Metadata } from 'next';
import { redirectUnlessLaunched } from '../../../../features/coming-soon/launch-gate';
import type { SearchParams } from '../../../../features/access/decision';
import { openReplay } from '../../../../features/watch/open-replay';
import { parseReplayQuery } from '../../../../features/watch/replay-query';
import { watchSource } from '../../../../features/watch/round-source';
import { viewerOf } from '../../../../features/watch/viewer';
import { requestIdentity } from '../../../../lib/request-session';
import { Replay } from '../../../../ui/watch/replay/replay';
import { ReplayRefusal } from '../../../../ui/watch/replay-refusal/replay-refusal';

export const metadata: Metadata = { title: 'Replay' };

/** The public replay of a recorded Round; its Room's visibility decides who may open it. */
export default async function ReplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  redirectUnlessLaunched('watch');
  const { roundId } = await params;
  const screen = openReplay(
    roundId,
    viewerOf(await requestIdentity()),
    parseReplayQuery(await searchParams),
    watchSource,
  );
  return screen.kind === 'watch' ? (
    <Replay view={screen.view} />
  ) : (
    <div className="px-6 pt-8 pb-8 max-compact:px-4">
      <ReplayRefusal screen={screen} />
    </div>
  );
}
