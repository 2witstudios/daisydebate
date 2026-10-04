import Link from 'next/link';
import { NavItem } from '../../../../components/nav-item/nav-item';
import { Icon } from '../../../../components/icon/icon';
import { NavToggle } from './nav-toggle';
import type { ShellAccount } from '../topbar/topbar';

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

const footerLinks = [
  { href: '/help', label: 'Help' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
] as const;

export type SidebarProps = {
  /** Signed-in members get a Profile link to their own page. */
  readonly account: ShellAccount;
};

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
    <nav
      aria-label="Primary"
      className="flex h-full flex-col justify-between pb-4"
    >
      <div>
        <NavToggle />
        <ul className="flex list-none flex-col gap-1 p-4 icons:px-2 icons:py-0">
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
      <p className="mx-5 mt-6 mb-2 flex flex-col gap-2 rounded-xl bg-surface-raised px-4 py-5 text-sm text-ink-muted italic short:hidden icons:hidden">
        <Icon name="quote" size={18} className="text-accent" />
        <span>
          Better arguments.
          <br />A more thoughtful world.
        </span>
      </p>
      <ul className="mx-5 flex list-none flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted icons:hidden">
        {footerLinks.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-ink-muted">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
