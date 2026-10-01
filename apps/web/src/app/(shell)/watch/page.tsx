import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { signInHref } from '../../../features/access/decision';
import { followingOf } from '../../../features/watch/debate-source';
import { countHub, listLive } from '../../../features/watch/list-live';
import { hubHref, parseLiveQuery } from '../../../features/watch/live-query';
import { viewerOf } from '../../../features/watch/viewer';
import { requestIdentity } from '../../../lib/request-session';
import { FollowingTab } from '../../../ui/watch/following-tab/following-tab';
import { LiveTab } from '../../../ui/watch/live-tab/live-tab';
import { WatchHub } from '../../../ui/watch/watch-hub/watch-hub';

export const metadata: Metadata = { title: 'Watch' };

/** The public hub: what is live now, and the viewer's own follows. */
export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseLiveQuery(await searchParams);
  const viewer = viewerOf(await requestIdentity());
  return (
    <WatchHub active={query.tab} counts={countHub()}>
      {query.tab === 'following' ? (
        <FollowingTab
          following={viewer.signedIn ? followingOf(viewer) : null}
          signInHref={signInHref(hubHref(query))}
        />
      ) : (
        <LiveTab query={query} listing={listLive(query)} />
      )}
    </WatchHub>
  );
}
