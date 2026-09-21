import { NavItem } from '../../../../components/nav-item/nav-item';
import { Icon } from '../../../../components/icon/icon';

const navigation = [
  { href: '/', icon: 'home', label: 'Home' },
  {
    href: '/play',
    icon: 'swords',
    label: 'Play / Lobby',
    children: [
      { href: '/play', label: 'Play' },
      { href: '/lobby', label: 'Lobby' },
    ],
  },
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
  { href: '/train', icon: 'bolt', label: 'Train' },
  { href: '/prep', icon: 'book', label: 'Prep' },
  { href: '/profile/alex-chen', icon: 'person', label: 'Profile' },
  { href: '/settings', icon: 'dots', label: 'More' },
] as const;

export function Sidebar() {
  return (
    <nav
      aria-label="Primary"
      className="flex h-full flex-col justify-between py-4"
    >
      <ul className="flex list-none flex-col gap-1 p-4 max-compact:px-2 max-compact:py-0">
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
      <p className="mx-5 mt-6 mb-2 flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-5 text-sm text-ink-muted italic max-compact:hidden short:hidden">
        <Icon name="quote" size={18} className="text-accent" />
        <span>
          Better arguments.
          <br />A more thoughtful world.
        </span>
      </p>
    </nav>
  );
}
