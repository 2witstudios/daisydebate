import type { ReactNode } from 'react';
import Link from 'next/link';
import type { ClubSeatsView } from '../../features/clubs/views';
import { TabLinks } from '../components/tab-links/tab-links';
import { clubKindLabel, dollars, seatTally } from './club-copy';

type Section = 'seats' | 'billing' | 'releases' | 'youth';

type SeatsSummary = Pick<ClubSeatsView, 'club' | 'plan'> & {
  readonly seats: readonly unknown[];
  readonly invitations?: readonly { readonly expired: boolean }[];
};

/**
 * The media release sections (ADR 0151), shown while youth publishing is
 * open: how many students still need a release.
 */
export type ClubReleaseTabs = { readonly needing: number };

type Tab = Parameters<typeof TabLinks>[0]['tabs'][number];

const seatTabs = (view: SeatsSummary, section: Section): Tab[] => {
  const { club, plan } = view;
  const tally = seatTally({ ...view, invitations: view.invitations ?? [] });
  return [
    {
      id: 'seats',
      label: `Seats · ${tally.filled} of ${plan.seatCount}`,
      href: `/clubs/${club.id}/seats`,
      selected: section === 'seats',
    },
    {
      id: 'billing',
      label: `Billing · ${dollars(plan.monthlyTotalMinor)}`,
      href: `/clubs/${club.id}/billing`,
      selected: section === 'billing',
    },
  ];
};

const releaseTabs = (
  clubId: string,
  releases: ClubReleaseTabs,
  section: Section,
): Tab[] => [
  {
    id: 'releases',
    label: `Media releases · ${releases.needing}`,
    href: `/clubs/${clubId}/releases`,
    selected: section === 'releases',
  },
  {
    id: 'youth',
    label: 'Youth tournaments',
    href: `/clubs/${clubId}/youth`,
    selected: section === 'youth',
  },
];

function Frame({
  club,
  subtitle,
  tabs,
  children,
}: {
  readonly club: { readonly name: string };
  readonly subtitle: string;
  readonly tabs: readonly Tab[];
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-bold tracking-widest text-ink-muted uppercase">
            Club
          </span>
          <strong className="font-display text-lg">{club.name}</strong>
          <span className="text-sm text-ink-muted">{subtitle}</span>
        </div>
        <Link href="/" className="text-sm text-ink-muted hover:text-ink">
          Back to Daisy
        </Link>
      </div>
      <TabLinks label="Club sections" tabs={tabs} />
      {children}
    </div>
  );
}

const planSubtitle = (view: SeatsSummary) =>
  `${clubKindLabel(view.club.kind)} · ${view.plan.seatCount} ${view.plan.seatCount === 1 ? 'seat' : 'seats'}`;

/**
 * A club's pages for its owner: the club named once, then its sections. The
 * media release sections show while youth publishing is open; students'
 * Rounds belongs to a later slice.
 */
export function ClubFrame({
  view,
  section,
  releases = null,
  children,
}: {
  readonly view: SeatsSummary;
  readonly section: Section;
  readonly releases?: ClubReleaseTabs | null;
  readonly children: ReactNode;
}) {
  return (
    <Frame
      club={view.club}
      subtitle={planSubtitle(view)}
      tabs={[
        ...seatTabs(view, section),
        ...(releases === null
          ? []
          : releaseTabs(view.club.id, releases, section)),
      ]}
    >
      {children}
    </Frame>
  );
}

/**
 * The media release pages' frame (ADR 0151). The owner, whose seats read
 * answered, keeps Seats and Billing; a school's staff member sees only the
 * two release sections.
 */
export function ClubReleaseFrame({
  club,
  seats,
  releases,
  section,
  children,
}: {
  readonly club: {
    readonly id: string;
    readonly name: string;
    readonly kind: 'school' | 'family';
  };
  /** The owner's seats summary; null for staff, or while seats are closed. */
  readonly seats: SeatsSummary | null;
  readonly releases: ClubReleaseTabs;
  readonly section: 'releases' | 'youth';
  readonly children: ReactNode;
}) {
  return (
    <Frame
      club={club}
      subtitle={seats === null ? clubKindLabel(club.kind) : planSubtitle(seats)}
      tabs={[
        ...(seats === null ? [] : seatTabs(seats, section)),
        ...releaseTabs(club.id, releases, section),
      ]}
    >
      {children}
    </Frame>
  );
}
