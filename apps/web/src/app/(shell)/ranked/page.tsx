import Link from 'next/link';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { processApp } from '../../../server/process-app';
import { readMemberStandings } from '../../../features/ratings/read-member';
import { MemberStandings } from '../../../ui/ranked/member-standings';
import { PageHeader } from '../../../ui/components/page-header/page-header';
import { buttonClass } from '../../../ui/components/button/button-class';
export const metadata: Metadata = { title: 'Rated debate' };

export default async function RankedPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/ranked', searchParams);
  const app = processApp();
  const standings =
    identity.state === 'member'
      ? await readMemberStandings(app.database, {
          username: identity.username,
          now: app.clock.now(),
          ...(identity.principal.actorId
            ? { viewerActorId: identity.principal.actorId }
            : {}),
        })
      : [];
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 p-6">
      <PageHeader title="Rated debate" />
      <MemberStandings standings={standings} />
      <div className="flex flex-wrap gap-3">
        <Link href="/play/room?rated=1" className={buttonClass('primary')}>
          Create a rated room
        </Link>
        <Link href="/lobby?mode=ranked" className={buttonClass('secondary')}>
          Browse rated rooms
        </Link>
        <Link href="/leaderboard">Leaderboard</Link>
      </div>
    </div>
  );
}
