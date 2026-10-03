export type MockNotification = {
  readonly id: string;
  readonly text: string;
  /** Where the notification leads. */
  readonly href: string;
  /** Minutes before now. */
  readonly minutesAgo: number;
  readonly unread: boolean;
};

/** Sample notifications for the signed-in viewer. */
export const sampleNotifications: readonly MockNotification[] = [
  {
    id: 'ballot-ready',
    text: 'A judge submitted the ballot for your debate with debater-b.',
    href: '/debates/started?turn=6&kind=person&by=person',
    minutesAgo: 12,
    unread: true,
  },
  {
    id: 'room-full',
    text: 'Your room “Tuesday practice” has everyone seated.',
    href: '/rooms/created',
    minutesAgo: 45,
    unread: true,
  },
  {
    id: 'assigned-judge',
    text: 'You were assigned to judge a debate.',
    href: '/judge',
    minutesAgo: 190,
    unread: true,
  },
  {
    id: 'tournament-open',
    text: 'Registration opened for a tournament you follow.',
    href: '/tournaments',
    minutesAgo: 60 * 26,
    unread: false,
  },
  {
    id: 'rating-change',
    text: 'Your rating moved after a ranked debate.',
    href: '/leaderboard',
    minutesAgo: 60 * 52,
    unread: false,
  },
];
