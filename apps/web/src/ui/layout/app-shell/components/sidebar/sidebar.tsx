import Link from 'next/link';
import { DaisyLogo } from '../../../../components/daisy-mark/daisy-mark';
import { NavItem } from '../../../../components/nav-item/nav-item';
import { Icon } from '../../../../components/icon/icon';
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

const visitorLink =
  'mx-4 flex min-h-12 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-bold whitespace-nowrap text-accent-ink no-underline hover:bg-accent-strong hover:no-underline icons:mx-2 icons:px-0';

/**
 * A visitor's way in. A member has none here: their account sits at the top
 * of the social rail with their friends.
 */
function VisitorAccount({ account }: { readonly account: ShellAccount }) {
  if (account.state === 'member') return null;
  const [href, label] =
    account.state === 'anonymous'
      ? ['/sign-in', 'Sign in']
      : ['/onboarding/username', 'Finish sign-up'];
  return (
    <Link href={href} aria-label={label} className={visitorLink}>
      <Icon name="person" size={18} className="hidden icons:block" />
      <span className="icons:sr-only">{label}</span>
    </Link>
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
      <Link
        href="/"
        aria-label="Daisy Debate home"
        className="flex h-16 shrink-0 items-center gap-2 px-5 text-ink no-underline hover:no-underline icons:justify-center icons:px-0"
      >
        <DaisyLogo />
        <span className="font-display text-xl leading-shell-brand font-semibold tracking-tight whitespace-nowrap text-ink icons:hidden">
          Daisy Debate
        </span>
      </Link>
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
      <div className="mt-4 flex flex-col gap-3">
        <VisitorAccount account={account} />
        <NavToggle />
      </div>
    </nav>
  );
}
