import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { openSpectate } from '../../../../features/watch/open-spectate';
import { parseSpectateQuery } from '../../../../features/watch/spectate-query';
import { viewerOf } from '../../../../features/watch/viewer';
import { requestIdentity } from '../../../../lib/request-session';
import { Spectate } from '../../../../ui/watch/spectate/spectate';
import { SpectateRefusal } from '../../../../ui/watch/spectate-refusal/spectate-refusal';

export const metadata: Metadata = { title: 'Live debate' };

/**
 * The public live view. The page is open to everyone; only the audience
 * needs an account, so a visitor with none gets the signed-out refusal here,
 * with a way to sign in and come back.
 */
export default async function LiveDebatePage({
  params,
  searchParams,
}: {
  params: Promise<{ debateId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { debateId } = await params;
  const viewer = viewerOf(await requestIdentity());
  const screen = openSpectate(
    debateId,
    viewer,
    parseSpectateQuery(await searchParams),
  );
  return screen.kind === 'watch' ? (
    <Spectate view={screen.view} />
  ) : (
    <div className="px-6 pt-8 pb-8 max-compact:px-4">
      <SpectateRefusal screen={screen} />
    </div>
  );
}
