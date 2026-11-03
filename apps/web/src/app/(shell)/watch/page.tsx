import type { Metadata } from 'next';
import { redirectUnlessLaunched } from '../../../features/coming-soon/launch-gate';
import type { SearchParams } from '../../../features/access/decision';
import { accountOf } from '../../../features/access/account-of';
import { signInHref } from '../../../features/access/decision';
import { hubHref, parseLiveQuery } from '../../../features/watch/live-query';
import {
  requestFollowing,
  requestHubCounts,
  requestIdentity,
  requestLiveListing,
} from '../../../lib/request-session';
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
  redirectUnlessLaunched('watch');
  const query = parseLiveQuery(await searchParams);
  const account = accountOf(await requestIdentity());
  return (
    <WatchHub active={query.tab} counts={await requestHubCounts()}>
      {query.tab === 'following' ? (
        <FollowingTab
          following={account ? await requestFollowing(account.userId) : null}
          signInHref={signInHref(hubHref(query))}
        />
      ) : (
        <LiveTab query={query} listing={await requestLiveListing(query)} />
      )}
    </WatchHub>
  );
}
