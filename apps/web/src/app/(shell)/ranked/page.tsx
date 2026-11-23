import Link from 'next/link';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import {
  requestMemberDivision,
  requestMemberStandings,
} from '../../../features/ratings/page-reads';
import { RankedLadders } from '../../../ui/ranked/ranked-ladders';
import { PageHeader } from '../../../ui/components/page-header/page-header';
import { buttonClass } from '../../../ui/components/button/button-class';
export const metadata: Metadata = { title: 'Ranked debate' };

export default async function RankedPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/ranked', searchParams);
  const [standings, division] = await Promise.all([
    identity.state === 'member'
      ? requestMemberStandings(identity.username)
      : [],
    requestMemberDivision(),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 p-6">
      <PageHeader title="Ranked debate" />
      <RankedLadders standings={standings} division={division} />
      <div className="flex flex-wrap gap-3">
        {division === null ? null : (
          <Link href="/play/room?ranked=1" className={buttonClass('primary')}>
            Create a ranked room
          </Link>
        )}
        <Link href="/lobby?mode=ranked" className={buttonClass('secondary')}>
          Browse ranked rooms
        </Link>
        <Link href="/leaderboard" className={buttonClass('ghost')}>
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
