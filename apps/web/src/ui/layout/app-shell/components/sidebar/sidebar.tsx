import Link from 'next/link';
import { DaisyLogo } from '../../../../components/daisy-mark/daisy-mark';
import { NavItem } from '../../../../components/nav-item/nav-item';
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
    <nav aria-label="Primary" className="flex h-full flex-col pb-4">
      {/* Collapsed, the logo sits over the control to expand again. */}
      <div className="flex h-16 shrink-0 items-center gap-2 pr-2 pl-4 icons:h-auto icons:flex-col icons:px-0 icons:pb-2">
        <Link
          href="/"
          aria-label="Daisy Debate home"
          className="flex h-16 min-w-0 flex-1 items-center gap-2 text-ink no-underline hover:no-underline icons:flex-none icons:justify-center"
        >
          <DaisyLogo />
          <span className="font-display text-xl leading-shell-brand font-semibold tracking-tight whitespace-nowrap text-ink icons:hidden">
            Daisy Debate
          </span>
        </Link>
        <NavToggle />
      </div>
      <div className="flex-1">
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
