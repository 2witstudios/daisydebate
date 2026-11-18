import type { ReactNode } from 'react';
import Link from 'next/link';
import type { ClubSeatsView } from '../../features/clubs/views';
import { TabLinks } from '../components/tab-links/tab-links';
import { clubKindLabel, dollars, seatTally } from './club-copy';

type Section = 'seats' | 'billing';

/**
 * A club's pages: the club named once, then its sections. The boards'
 * sidebar sections that belong to later slices (media releases, Youth
 * tournaments, students' Rounds) are not shown.
 */
export function ClubFrame({
  view,
  section,
  children,
}: {
  readonly view: Pick<ClubSeatsView, 'club' | 'plan'> & {
    readonly seats: readonly unknown[];
    readonly invitations?: readonly { readonly expired: boolean }[];
  };
  readonly section: Section;
  readonly children: ReactNode;
}) {
  const { club, plan } = view;
  const tally = seatTally({ ...view, invitations: view.invitations ?? [] });
  const base = `/clubs/${club.id}`;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-bold tracking-widest text-ink-muted uppercase">
            Club
          </span>
          <strong className="font-display text-lg">{club.name}</strong>
          <span className="text-sm text-ink-muted">
            {clubKindLabel(club.kind)} · {plan.seatCount}{' '}
            {plan.seatCount === 1 ? 'seat' : 'seats'}
          </span>
        </div>
        <Link href="/" className="text-sm text-ink-muted hover:text-ink">
          Back to Daisy
        </Link>
      </div>
      <TabLinks
        label="Club sections"
        tabs={[
          {
            id: 'seats',
            label: `Seats · ${tally.filled} of ${plan.seatCount}`,
            href: `${base}/seats`,
            selected: section === 'seats',
          },
          {
            id: 'billing',
            label: `Billing · ${dollars(plan.monthlyTotalMinor)}`,
            href: `${base}/billing`,
            selected: section === 'billing',
          },
        ]}
      />
      {children}
    </div>
  );
}
