import type { Metadata } from 'next';
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
import { WatchBusy } from '../../../ui/watch/watch-busy/watch-busy';
import { WatchHub } from '../../../ui/watch/watch-hub/watch-hub';

export const metadata: Metadata = { title: 'Watch' };

/** The public hub: what is live now, and the viewer's own follows. */
export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseLiveQuery(await searchParams);
  const account = accountOf(await requestIdentity());
  const listing =
    query.tab === 'following' ? null : await requestLiveListing(query);
  return (
    <WatchHub active={query.tab} counts={await requestHubCounts()}>
      {query.tab === 'following' ? (
        <FollowingTab
          following={account ? await requestFollowing(account.userId) : null}
          signInHref={signInHref(hubHref(query))}
        />
      ) : listing === 'refused' ? (
        <WatchBusy retryHref={hubHref(query)} />
      ) : listing ? (
        <LiveTab query={query} listing={listing} />
      ) : null}
    </WatchHub>
  );
}
