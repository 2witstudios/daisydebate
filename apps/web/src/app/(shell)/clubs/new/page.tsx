import type { Metadata } from 'next';
import { requireAccess } from '../../../../features/access/page-access';
import type { SearchParams } from '../../../../features/access/decision';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { StartClubForm } from '../../../../ui/clubs/start-club-form';
import { requireClubRelease } from '../release';
import { startClubAction } from '../actions';

export const metadata: Metadata = { title: 'Start a club' };

/** Start a club: name, kind and seats, then Stripe Checkout. */
export default async function StartClub({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/clubs/new', searchParams);
  await requireClubRelease(identity);
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader
        title="Start a club"
        lede="Premium for every student you seat, on one bill. Seats move between students whenever you need."
      />
      <StartClubForm action={startClubAction} />
    </div>
  );
}
