import type {
  Honour,
  LastRound,
  ResultsData,
  StandingLine,
} from '../../features/tournaments/results';
import { sampleTournaments } from './tournaments';

const line = (
  place: string,
  handle: string,
  seed: number,
  rating: number,
  record: string,
  honour: string | null = null,
): StandingLine => ({ place, handle, seed, rating, record, honour });

const summerStandings: readonly StandingLine[] = [
  line('1', 'debater-c', 1, 1705, '4-0', 'Champion'),
  line('2', 'debater-a', 4, 1620, '3-1', 'Runner-up'),
  line('3=', 'debater-g', 3, 1650, '2-1', 'Semifinalist'),
  line('3=', 'debater-i', 7, 1490, '2-1', 'Semifinalist'),
  line('5=', 'debater-d', 2, 1690, '1-1', 'Quarterfinalist'),
  line('5=', 'debater-b', 5, 1588, '1-1', 'Quarterfinalist'),
  line('5=', 'debater-h', 6, 1540, '1-1', 'Quarterfinalist'),
  line('5=', 'debater-j', 8, 1475, '1-1', 'Quarterfinalist'),
  ...[
    'debater-k',
    'debater-m',
    'entrant-11',
    'entrant-12',
    'entrant-13',
    'entrant-14',
    'entrant-15',
    'entrant-16',
  ].map((handle, index) =>
    line('9=', handle, 9 + index, 1402 - index * 9, '0-1'),
  ),
];

const summerRounds: readonly LastRound[] = [
  { label: 'Final', winner: 'debater-c', loser: 'debater-a', judge: 'judge-a' },
  {
    label: 'Semifinal 1',
    winner: 'debater-c',
    loser: 'debater-g',
    judge: 'judge-b',
  },
  {
    label: 'Semifinal 2',
    winner: 'debater-a',
    loser: 'debater-i',
    judge: 'judge-c',
  },
];

const summerHonours: readonly Honour[] = [
  {
    title: 'Champion',
    who: '@debater-c',
    text: 'Honour on the profile and a certificate.',
  },
  {
    title: 'Runner-up',
    who: '@debater-a',
    text: 'Honour on the profile and a certificate.',
  },
  {
    title: 'Semifinalists',
    who: '@debater-g, @debater-i',
    text: 'Honour and a certificate each.',
  },
  {
    title: 'Every entrant',
    who: '16 debaters',
    text: 'A participation record on the profile.',
  },
];

const midsummerStandings: readonly StandingLine[] = [
  line('1', 'debater-d', 1, 1690, '5-0', 'Winner'),
  line('2', 'debater-c', 2, 1705, '4-1'),
  line('3', 'debater-g', 3, 1650, '3-2'),
  line('4', 'debater-b', 4, 1588, '2-3'),
  line('5', 'debater-h', 5, 1540, '1-4'),
  line('6', 'debater-j', 6, 1475, '0-5'),
];

/**
 * Sample published results for the two completed tournaments. `signedIn`
 * decides whether the viewer has a personal result (Summer Invitational
 * only). Handles, seeds, ratings and ballots are samples.
 */
export const sampleResults = (
  id: string,
  signedIn: boolean,
): ResultsData | null => {
  const tournament = sampleTournaments.find((item) => item.id === id);
  if (tournament?.id === 'summer-invitational')
    return {
      tournament,
      publishedAt: '2026-08-30T12:00:00.000Z',
      standings: summerStandings,
      lastRounds: summerRounds,
      honours: summerHonours,
      mine: signedIn
        ? {
            honour: 'Runner-up',
            headline: 'You placed second.',
            summary: 'Won 3 of 4 rounds. Lost the final to @debater-c.',
            rounds: [
              { label: 'Round of 16', opponent: 'debater-k', result: 'Won' },
              { label: 'Quarterfinal', opponent: 'debater-h', result: 'Won' },
              { label: 'Semifinal', opponent: 'debater-i', result: 'Won' },
              { label: 'Final', opponent: 'debater-c', result: 'Lost' },
            ],
            certificate: {
              id: 'cert-sample-0001',
              recipient: 'debater-a',
              placing: 'placed second as runner-up',
              organizer: 'Daisy Debate',
            },
          }
        : null,
    };
  if (tournament?.id === 'midsummer-round-robin')
    return {
      tournament,
      publishedAt: '2026-07-05T12:00:00.000Z',
      standings: midsummerStandings,
      lastRounds: [
        {
          label: 'Round 5',
          winner: 'debater-d',
          loser: 'debater-j',
          judge: 'judge-a',
        },
        {
          label: 'Round 5',
          winner: 'debater-c',
          loser: 'debater-h',
          judge: 'judge-b',
        },
        {
          label: 'Round 5',
          winner: 'debater-g',
          loser: 'debater-b',
          judge: 'judge-c',
        },
      ],
      honours: [
        {
          title: 'Winner',
          who: '@debater-d',
          text: 'Honour on the profile and a certificate.',
        },
        {
          title: 'Every entrant',
          who: '6 debaters',
          text: 'A participation record on the profile.',
        },
      ],
      mine: null,
    };
  return null;
};
