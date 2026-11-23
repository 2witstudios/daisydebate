import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAccess } from '../../../../../features/access/page-access';
import { requestNow } from '../../../../../lib/page-reads';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  clubBillingViewSchema,
  clubSeatsViewSchema,
} from '../../../../../features/clubs/views';
import {
  ClubBillingPage,
  clubBillingNotices,
  type ClubBillingNotice,
} from '../../../../../ui/clubs/billing-page';
import { readOwnRoute } from '../../../friends/read-route';
import { GET as billingRoute } from '../../../../api/clubs/[club]/billing/route';
import { GET as seatsRoute } from '../../../../api/clubs/[club]/seats/route';
import { requireClubRelease } from '../../release';
import { clubSeatCountAction } from '../../actions';

import { readClubReleaseTabs } from '../releases/read';

export const metadata: Metadata = { title: 'Club billing' };

const clubId = /^[a-z0-9]{24}$/;

/** A club's plan, seat changes and invoices. Return parameters are notices only. */
export default async function ClubBilling({
  params,
  searchParams,
}: {
  params: Promise<{ club: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { club } = await params;
  const identity = await requireAccess(`/clubs/${club}/billing`, searchParams);
  await requireClubRelease(identity);
  if (!clubId.test(club)) notFound();
  const [view, seating] = await Promise.all([
    readOwnRoute(
      (request) => billingRoute(request, { params: Promise.resolve({ club }) }),
      `/api/clubs/${club}/billing`,
      clubBillingViewSchema,
    ),
    readOwnRoute(
      (request) => seatsRoute(request, { params: Promise.resolve({ club }) }),
      `/api/clubs/${club}/seats`,
      clubSeatsViewSchema,
    ),
  ]);
  if (!view || !seating) notFound();
  const query = await searchParams;
  const notice =
    typeof query.notice === 'string' && query.notice in clubBillingNotices
      ? (query.notice as ClubBillingNotice)
      : undefined;
  return (
    <ClubBillingPage
      releases={await readClubReleaseTabs(club)}
      view={view}
      seating={seating}
      returned={typeof query.purchase === 'string'}
      now={requestNow()}
      {...(notice === undefined ? {} : { notice })}
      action={clubSeatCountAction.bind(null, club)}
    />
  );
}
