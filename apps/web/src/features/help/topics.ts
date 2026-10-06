type Link = { readonly label: string; readonly href: string };

export type HelpTopic = {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly links: readonly Link[];
};

/** The help topics, in the order people usually need them. */
export const helpTopics: readonly HelpTopic[] = [
  {
    id: 'onboarding',
    question: 'Where do I see the introduction again?',
    answer:
      'The introduction covers why debate, how Daisy works and how a debate runs, then asks what you want to do here. Your answers stay editable from its last step.',
    links: [{ label: 'Start the introduction', href: '/onboarding/welcome' }],
  },
  {
    id: 'start-a-debate',
    question: 'How do I start a debate?',
    answer:
      'Open a room in the lobby or play from the Play page. Take a seat, wait for an opponent and a judge, and ready up. The host can choose a person or a placeholder AI judge.',
    links: [
      { label: 'Play', href: '/play' },
      { label: 'Lobby', href: '/lobby' },
    ],
  },
  {
    id: 'ranked-or-practice',
    question: 'What is the difference between ranked and practice?',
    answer:
      'Ranked debates follow the standard rules, use a judge Daisy assigns, and change your rating. Practice rooms are unranked and let the host choose the settings.',
    links: [
      { label: 'Ranked', href: '/ranked' },
      { label: 'Leaderboards', href: '/leaderboard' },
    ],
  },
  {
    id: 'judging',
    question: 'How does judging work?',
    answer:
      'A judge scores each side and gives a decision with a written reason. Both debaters can read it once the ballot is submitted.',
    links: [{ label: 'Judge', href: '/judge' }],
  },
  {
    id: 'learn-the-rules',
    question: 'Where can I learn the rules and practise?',
    answer:
      'The Train area walks through the format, offers drills and practice rounds, and reviews your past debates.',
    links: [
      { label: 'Rules', href: '/train/rules' },
      { label: 'Train', href: '/train' },
    ],
  },
  {
    id: 'your-data',
    question: 'How do I see or delete my data?',
    answer:
      'Everything about your account is in Settings, including privacy choices, export and deletion. The privacy policy explains what we keep and why.',
    links: [
      { label: 'Settings', href: '/settings' },
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Terms of service', href: '/terms' },
    ],
  },
];
