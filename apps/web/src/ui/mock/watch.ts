import type { Turn as SampleTurn } from '../../features/watch/schedule';
import type { Followed, WatchedItem } from '../../features/watch/social';
import type { SpeechPhase, WatchViewer } from '../../features/watch/debate';

/** The signed-in viewer's sample identity. */
export const sampleViewer: WatchViewer = {
  signedIn: true,
  handle: 'you',
  rating: 1412,
};

/**
 * Placeholder speech slots: the rules supply the real order, sides and
 * lengths later, so every name and length here is a sample.
 */
export const samplePhases: readonly SpeechPhase[] = [
  { name: 'Speech [1]', abbreviation: 'S1', seconds: 300, side: 'aff' },
  { name: 'Speech [2]', abbreviation: 'S2', seconds: 300, side: 'neg' },
  { name: 'Speech [3]', abbreviation: 'S3', seconds: 300, side: 'aff' },
  { name: 'Speech [4]', abbreviation: 'S4', seconds: 300, side: 'neg' },
  { name: 'Speech [5]', abbreviation: 'S5', seconds: 300, side: 'aff' },
  { name: 'Speech [6]', abbreviation: 'S6', seconds: 300, side: 'neg' },
];

const sampleTurnTexts: readonly string[] = [
  'My case is [case]. The first reason is [claim one], because [warrant], and the impact is [impact].',
  'The second reason is [claim two]. Together they show the resolution holds because [summary].',
  'I disagree with [point]. Their first reason has a gap at [gap], and here is why it matters: [impact].',
  'My own case is [negative case]. It outweighs theirs on [weighing].',
  'On their gap at [gap], the answer is [response]. Their case does not answer [argument].',
  'I extend [claim one] because [reason], and I turn their [negative case] with [turn].',
  'They dropped [argument], so my standard stays. The evidence for [claim] is [source].',
  'Even if you prefer their framing, [impact] outweighs on magnitude.',
  'Three issues remain. On [issue one], [response]. On [issue two], [extension]. On [issue three], [turn].',
  'The dropped point does not decide the round, because [reason].',
  'The round comes down to [deciding issue]. On it, my case wins because [reason].',
  'Vote Neg. The resolution fails under [standard], and they did not answer [argument].',
];

/** Two sample turns per phase; every debate reads the same placeholder text. */
export const sampleTurns: readonly SampleTurn[] = sampleTurnTexts.map(
  (text, index) => ({
    phaseIndex: Math.floor(index / 2),
    startSeconds: index * 150,
    text,
  }),
);

export const sampleResolution = 'Resolved: [resolution].';
export const sampleSeason = '[N]';
/** The delay spectators watch behind the debate, in seconds (a sample). */
export const sampleDelaySeconds = 30;
/** Sample spectator chat, reactions and their house rules. */
export const sampleReactions = [
  { id: 'sharp', label: 'Sharp point', count: 38 },
  { id: 'rebut', label: 'Good rebuttal', count: 24 },
  { id: 'evidence', label: 'Needs evidence', count: 9 },
  { id: 'clear', label: 'Clear structure', count: 17 },
] as const;
export const sampleChat = [
  {
    id: 'c1',
    handle: 'spectator-one',
    at: '18:02',
    text: 'The criterion fight is the whole round.',
  },
  {
    id: 'c2',
    handle: 'spectator-two',
    at: '18:03',
    text: 'That cross-ex exchange was sharp.',
  },
  { id: 'c3', handle: 'spectator-four', at: '18:04', text: null },
  {
    id: 'c4',
    handle: 'spectator-three',
    at: '18:05',
    text: 'Does anyone know the [source] they cited?',
  },
  {
    id: 'c5',
    handle: 'spectator-one',
    at: '18:06',
    text: 'Neg is pressing on that point now.',
  },
] as const;
export const sampleChatRules =
  'Links are blocked. One message every 10 s. Only spectators see chat, never the debaters or judges.';

/** Sample follows and watch history, private to the viewer. */
export const sampleFollowing: readonly Followed[] = [
  {
    handle: 'debater-g',
    live: { id: 'quarterfinal-practice', title: 'Quarterfinal practice' },
    lastDebate: null,
  },
  { handle: 'debater-q', live: null, lastDebate: 'Last debate 2 days ago' },
  { handle: 'debater-t', live: null, lastDebate: 'Last debate 6 days ago' },
];
export const sampleHistory: readonly WatchedItem[] = [
  {
    id: 'semifinal-rehearsal',
    title: 'Semifinal rehearsal',
    note: 'Replay, stopped at 14:20',
  },
  {
    id: 'top-of-the-ladder',
    title: 'Top of the ladder',
    note: 'Watched live yesterday',
  },
  { id: 'open-table', title: 'Open table', note: 'Replay, finished' },
];
