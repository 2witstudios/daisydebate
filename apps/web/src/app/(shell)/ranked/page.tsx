import Link from 'next/link';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import {
  requestMemberStandings,
  requestRankedPlayAdmitted,
} from '../../../lib/request-session';
import { MemberStandings } from '../../../ui/ranked/member-standings';
import { RankedAgeNotice } from '../../../ui/ranked/ranked-age-notice';
import { PageHeader } from '../../../ui/components/page-header/page-header';
import { buttonClass } from '../../../ui/components/button/button-class';
export const metadata: Metadata = { title: 'Ranked debate' };

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
  const mayPlay = await requestRankedPlayAdmitted();
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 p-6">
      <PageHeader title="Ranked debate" />
      <MemberStandings standings={standings} />
      {mayPlay ? null : <RankedAgeNotice />}
      <div className="flex flex-wrap gap-3">
        {mayPlay ? (
          <Link href="/play/room?ranked=1" className={buttonClass('primary')}>
            Create a ranked room
          </Link>
        ) : null}
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
