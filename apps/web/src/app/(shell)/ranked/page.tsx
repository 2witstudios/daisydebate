import Link from 'next/link';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { requestMemberStandings } from '../../../lib/request-session';
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
  const standings =
    identity.state === 'member'
      ? await requestMemberStandings(identity.username)
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
        <Link href="/leaderboard" className={buttonClass('ghost')}>
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
