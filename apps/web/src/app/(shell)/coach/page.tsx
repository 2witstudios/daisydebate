import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { clubSeatBounds } from '@daisy/protocol/club-seats';
import {
  ballotCategoryCount,
  ballotGroups,
} from '../../../features/marketing/ballot-card';
import { planPrices } from '../../../features/pricing/plan-prices';
import { CoachPage } from '../../../ui/marketing/coach-page';
import { requestAudienceLinks } from '../audience-links';

const description =
  'Give your debate club more rounds than its schedule allows: practice between meetings, a ballot and a recording to review, one plan for the club.';

export const metadata: Metadata = {
  title: 'Daisy for coaches and clubs',
  description,
  alternates: { canonical: '/coach' },
};

/** Public: Daisy for a coach or club, while Club seats are released. */
export default async function Coach() {
  const links = await requestAudienceLinks();
  if (links.coach === null) notFound();
  return (
    <CoachPage
      prices={planPrices}
      links={links}
      seatLimit={clubSeatBounds.maxSeats}
      ballot={{
        groups: ballotGroups(),
        categoryCount: ballotCategoryCount(),
      }}
    />
  );
}
