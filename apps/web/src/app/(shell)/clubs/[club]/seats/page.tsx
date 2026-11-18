import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAccess } from '../../../../../lib/access';
import type { SearchParams } from '../../../../../features/access/decision';
import { clubSeatsViewSchema } from '../../../../../features/clubs/views';
import {
  ClubSeatsPage,
  seatFilters,
  type SeatFilter,
} from '../../../../../ui/clubs/seats-page';
import { readOwnRoute } from '../../../friends/read-route';
import { GET } from '../../../../api/clubs/[club]/seats/route';
import { requireClubRelease } from '../../release';
import { clubSeatAction } from '../../actions';

export const metadata: Metadata = { title: 'Club seats' };

const clubId = /^[a-z0-9]{24}$/;

/** A club's seats, for its manager; anyone else finds no such page. */
export default async function ClubSeats({
  params,
  searchParams,
}: {
  params: Promise<{ club: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { club } = await params;
  const identity = await requireAccess(`/clubs/${club}/seats`, searchParams);
  await requireClubRelease(identity);
  if (!clubId.test(club)) notFound();
  const view = await readOwnRoute(
    GET,
    `/api/clubs/${club}/seats`,
    clubSeatsViewSchema,
  );
  if (!view) notFound();
  const show = (await searchParams).show;
  const filter: SeatFilter = seatFilters.includes(show as SeatFilter)
    ? (show as SeatFilter)
    : 'everyone';
  return (
    <ClubSeatsPage
      view={view}
      filter={filter}
      action={clubSeatAction.bind(null, club)}
    />
  );
}
