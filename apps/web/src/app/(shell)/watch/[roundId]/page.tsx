import type { Metadata } from 'next';
import { redirectUnlessLaunched } from '../../../../features/coming-soon/launch-gate';
import type { SearchParams } from '../../../../features/access/decision';
import { openSpectate } from '../../../../features/watch/open-spectate';
import { parseSpectateQuery } from '../../../../features/watch/spectate-query';
import { watchSource } from '../../../../features/watch/round-source';
import { viewerOf } from '../../../../features/watch/viewer';
import { requestIdentity } from '../../../../lib/request-session';
import { Spectate } from '../../../../ui/watch/spectate/spectate';
import { SpectateRefusal } from '../../../../ui/watch/spectate-refusal/spectate-refusal';

export const metadata: Metadata = { title: 'Live debate' };

/**
 * The public live view. Watching needs no account; interacting does.
 */
export default async function LiveRoundPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  redirectUnlessLaunched('watch');
  const { roundId } = await params;
  const viewer = viewerOf(await requestIdentity());
  const screen = openSpectate(
    roundId,
    viewer,
    parseSpectateQuery(await searchParams),
    watchSource,
  );
  return screen.kind === 'watch' ? (
    <Spectate view={screen.view} />
  ) : (
    <div className="px-6 pt-8 pb-8 max-compact:px-4">
      <SpectateRefusal screen={screen} />
    </div>
  );
}
