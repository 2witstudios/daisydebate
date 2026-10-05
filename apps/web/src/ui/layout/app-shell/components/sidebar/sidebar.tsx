import Link from 'next/link';
import { Icon } from '../../../../components/icon/icon';
import { NavItem } from '../../../../components/nav-item/nav-item';
import {
  navFlyoutClass,
  navFlyoutLinkClass,
} from '../../../../components/nav-item/nav-item-class';
import type { ShellAccount } from '../../account';
import { NavToggle } from './nav-toggle';

const baseNavigation = [
  { href: '/', icon: 'home', label: 'Home' },
  { href: '/play', icon: 'swords', label: 'Play' },
  { href: '/tournaments', icon: 'trophy', label: 'Tournaments' },
  { href: '/leaderboard', icon: 'chart', label: 'Leaderboards' },
  {
    href: '/watch',
    icon: 'eye',
    label: 'Watch',
    children: [
      { href: '/watch', label: 'Spectate live' },
      { href: '/recordings', label: 'Recordings' },
    ],
  },
  { href: '/judge', icon: 'gavel', label: 'Judge' },
  { href: '/train', icon: 'bolt', label: 'Train' },
  { href: '/prep', icon: 'book', label: 'Prep' },
] as const;

const trailingNavigation = [
  { href: '/settings', icon: 'dots', label: 'More' },
] as const;

const legalLinks = [
  { href: '/help', label: 'Help' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
] as const;

export type SidebarProps = {
  /** Signed-in members get a Profile link to their own page. */
  readonly account: ShellAccount;
};

/**
 * Help, Terms and Privacy, always the sidebar's last row. Icon only, a help
 * icon whose flyout lists them, on hover and keyboard focus.
 */
function LegalLinks() {
  return (
    <>
      <ul className="mx-6 flex list-none flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted icons:hidden">
        {legalLinks.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-ink-muted">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden justify-center icons:flex">
        <span className="group relative block">
          <Link
            href="/help"
            aria-label="Help, terms and privacy"
            title="Help, terms and privacy"
            className="flex size-12 items-center justify-center rounded-md text-ink-muted no-underline hover:bg-surface-overlay hover:text-ink hover:no-underline"
          >
            <Icon name="help" size={20} />
          </Link>
          <span className={navFlyoutClass('bottom')}>
            {legalLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={navFlyoutLinkClass}
              >
                {link.label}
              </Link>
            ))}
          </span>
        </span>
      </div>
    </>
  );
}

export function Sidebar({ account }: SidebarProps) {
  const navigation = [
    ...baseNavigation,
    ...(account.state === 'member'
      ? [
          {
            href: `/profile/${account.username}`,
            icon: 'person',
            label: 'Profile',
          } as const,
        ]
      : []),
    ...trailingNavigation,
  ];
  return (
    <nav aria-label="Primary" className="flex h-full flex-col pb-4">
      <div className="flex justify-end px-2 pt-2 max-compact:hidden icons:justify-center">
        <NavToggle />
      </div>
      <div className="flex-1">
        <ul className="flex list-none flex-col gap-1 px-2 py-2">
          {navigation.map((item) => (
            <li key={item.href}>
              <NavItem
                href={item.href}
                icon={item.icon}
                label={item.label}
                subItems={'children' in item ? item.children : undefined}
              />
            </li>
          ))}
        </ul>
      </div>
      <LegalLinks />
    </nav>
  );
}
