import { NavItem } from '../../../../components/nav-item/nav-item';
import { Icon } from '../../../../components/icon/icon';
import styles from './sidebar.module.css';

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
    <nav aria-label="Primary" className={styles.sidebar}>
      <ul className={styles.list}>
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
      <p className={styles.quote}>
        <Icon name="quote" size={18} className={styles.quoteMark} />
        <span>
          Better arguments.
          <br />A more thoughtful world.
        </span>
      </p>
    </nav>
  );
}
