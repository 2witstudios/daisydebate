import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { accountOf } from '../../../features/access/account-of';
import { signInHref } from '../../../features/access/decision';
import { hubHref, parseLiveQuery } from '../../../features/watch/live-query';
import { documentPrincipalOf } from '../../../features/documents/document-principal';
import {
  requestFollowing,
  requestHubCounts,
  requestIdentity,
  requestLiveListing,
  requestStudentsLive,
} from '../../../lib/request-session';
import { FollowingTab } from '../../../ui/watch/following-tab/following-tab';
import { LiveTab } from '../../../ui/watch/live-tab/live-tab';
import { StudentsLive } from '../../../ui/watch/students-live/students-live';
import { WatchBusy } from '../../../ui/watch/watch-busy/watch-busy';
import { WatchHub } from '../../../ui/watch/watch-hub/watch-hub';

export const metadata: Metadata = { title: 'Watch' };

/**
 * The public hub: what is live now, and the viewer's own follows. A linked
 * coach or parent also sees their students' live Youth Rounds, which the
 * public listing never holds (ADR 0155).
 */
export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseLiveQuery(await searchParams);
  const identity = await requestIdentity();
  const account = accountOf(identity);
  const member = documentPrincipalOf(identity);
  const [listing, students] =
    query.tab === 'following'
      ? [null, []]
      : await Promise.all([
          requestLiveListing(query),
          member ? requestStudentsLive(member) : [],
        ]);
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
        <>
          <StudentsLive cards={students} />
          <LiveTab query={query} listing={listing} />
        </>
      ) : null}
    </WatchHub>
  );
}
