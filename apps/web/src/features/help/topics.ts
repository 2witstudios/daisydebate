import { destinationHref } from '../destinations/destinations';
import { leaderboardDestinations } from '../leaderboard/actions';

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
      'The introduction covers the three ways to use Daisy: ranked Freestyle and how its round runs, practising your league’s format, and running your league or tournament. You can edit your onboarding answers in Settings.',
    links: [{ label: 'Start the introduction', href: '/onboarding/daisy' }],
  },
  {
    id: 'start-a-debate',
    question: 'How do I start a debate?',
    answer:
      'Open a room in the lobby or play from the Play page. Take a seat, wait for an opponent and a judge, and ready up. The host can invite a person to judge. An AI judge is free on ranked rounds and premium on casual rounds.',
    links: [
      { label: 'Play', href: '/play' },
      { label: 'Lobby', href: '/lobby' },
    ],
  },
  {
    id: 'ranked-or-practice',
    question: 'What is the difference between ranked and practice?',
    answer:
      'Ranked debates follow the standard rules, use a judge Daisy assigns, and change your rating. Casual rooms are unranked and let the host choose the settings.',
    links: [
      { label: 'Ranked', href: '/ranked' },
      { label: 'Leaderboard', href: destinationHref('leaderboard') },
    ],
  },
  {
    id: 'ratings',
    question: 'How does rating work?',
    answer:
      'Daisy rates ranked Freestyle debates with Glicko-2, the system Lichess uses. Like Elo, you gain more for beating a stronger opponent and lose more to a weaker one. Unlike Elo, your rating carries a range: it narrows as you play, widens while you are away, and your rating is provisional until it settles. Each season starts a new ladder.',
    links: [
      {
        label: 'How rating works',
        href: leaderboardDestinations.howRatingWorks,
      },
      { label: 'Leaderboard', href: destinationHref('leaderboard') },
    ],
  },
  {
    id: 'judging',
    question: 'Who judges debates?',
    answer:
      'Every round has a judge, who scores each side and gives a decision with a written reason. Both debaters can read it once the ballot is submitted. A room’s host can invite a person to judge, or seat an AI judge so the round never waits for one. An AI judge is free on ranked rounds and premium on casual rounds.',
    links: [{ label: 'Judge', href: '/judge' }],
  },
  {
    id: 'teams',
    question: 'Can I debate as a team?',
    answer:
      'Ranked Freestyle is one-on-one for now, so you can debate whenever you like without scheduling around a partner. Team formats such as Team IPDA and NCFCA Team Policy run as custom debates.',
    links: [{ label: 'Play', href: '/play' }],
  },
  {
    id: 'why-freestyle',
    question: 'Why is Freestyle Daisy’s standard?',
    answer:
      'Freestyle builds on American parliamentary debate, a format with a strong foundation: the resolution is chosen at the table, so nobody needs a season of prepared cases and anyone can join at any point. One shared format means one rating and one ladder, with everyone in the same building. Every other format still runs as a custom debate.',
    links: [{ label: 'Ranked', href: '/ranked' }],
  },
  {
    id: 'run-your-league',
    question: 'Can my league or tournament use Daisy?',
    answer:
      'Daisy’s league and tournament tools are rolling out in early access. A league will have its own lobby and ladder on Daisy, and can host tournaments online or in person with tabulation built in: events, entries, judges, pairings, ballots, results and standings. The Tournaments page says when it is open to your account.',
    links: [{ label: 'Tournaments', href: '/tournaments' }],
  },
  {
    id: 'ranked-recorded',
    question: 'Why are ranked rounds recorded?',
    answer:
      'Ranked rounds are the season’s record, and they are how debate finds an audience. Ranked rounds are broadcast and recorded, so results can be checked, rounds can be watched again, and the best moments become clips that promote debate. That is the deal for competing on the ladder, and you agree to it once a season in the content waiver. Prefer not to be recorded? Play casual: a non-ranked round belongs to the people in it. Your prep stays yours, and you can stream and post ranked rounds yourself with no royalty. There is no payment today; sharing revenue with debaters is a goal for a future program.',
    links: [
      { label: 'Ranked content waiver', href: '/content-waiver' },
      { label: 'Ranked content policy', href: '/content-policy' },
    ],
  },
  {
    id: 'learn-the-rules',
    question: 'Where can I learn the rules and practise?',
    answer:
      'The Train area pairs you with a bot opponent for a practice debate in an ordinary room; the room’s setup shows each format’s speeches and rules.',
    links: [{ label: 'Train', href: destinationHref('train') }],
  },
  {
    id: 'your-data',
    question: 'How do I see or delete my data?',
    answer:
      'Your privacy choices are in Settings. The privacy policy explains what we keep and why.',
    links: [
      { label: 'Settings', href: '/settings' },
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Terms of service', href: '/terms' },
      { label: 'Ranked content waiver', href: '/content-waiver' },
      { label: 'Ranked content policy', href: '/content-policy' },
    ],
  },
];
