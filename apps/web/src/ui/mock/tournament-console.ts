import type {
  ConsoleData,
  ConsoleEntrant,
  Outcome,
} from '../../features/tournaments/console';
import { sampleTournaments } from './tournaments';

const top: readonly (readonly [string, number])[] = [
  ['debater-c', 1705],
  ['debater-d', 1690],
  ['debater-g', 1650],
  ['debater-a', 1620],
  ['debater-b', 1588],
  ['debater-h', 1540],
  ['debater-i', 1490],
  ['debater-j', 1475],
];

const entrantsFor = (count: number): readonly ConsoleEntrant[] =>
  Array.from({ length: count }, (_, index): ConsoleEntrant => {
    const seed = index + 1;
    const known = top[index];
    return {
      seed,
      handle: known?.[0] ?? `entrant-${String(seed).padStart(2, '0')}`,
      rating: known?.[1] ?? 1402 - (seed - 9) * 7,
      status: known
        ? 'Bye'
        : seed % 3 === 0 || seed === 10
          ? 'Not checked in'
          : 'Checked in',
    };
  });

const autumnOutcomes: readonly Outcome[] = [
  { kind: 'ballot', winner: 'a' },
  { kind: 'ballot', winner: 'b' },
  { kind: 'live', watching: 31 },
  { kind: 'ballot', winner: 'a' },
  {
    kind: 'needs-result',
    note: 'Judge disconnected, no ballot for 18 minutes.',
  },
  { kind: 'live', watching: 12 },
  { kind: 'ballot', winner: 'b' },
  {
    kind: 'forfeit',
    absent: 'b',
    note: 'absent 10 minutes, forfeit requested.',
  },
];

const harvestOutcomes: readonly Outcome[] = [
  { kind: 'ballot', winner: 'a' },
  { kind: 'ballot', winner: 'b' },
  {
    kind: 'needs-result',
    note: 'Judge disconnected, no ballot for 18 minutes.',
  },
  { kind: 'live', watching: 12 },
];

const base = {
  withdrawn: 1,
  volunteers: 8,
  report: { debate: 'D2', by: 'entrant-23' },
  moderators: [
    { handle: 'moderator-one', state: 'Active' },
    { handle: 'moderator-two', state: 'Invited' },
  ],
  log: [
    {
      at: '14:41',
      text: '@organizer-one corrected D2: Affirmative to Negative. Reason: judge ballot was entered on the wrong side.',
    },
    {
      at: '14:33',
      text: 'Daisy replaced @judge-09 with @judge-05 on D5 after a judge dropout.',
    },
    { at: '14:12', text: 'The first round was released to entrants.' },
  ],
} as const satisfies Partial<ConsoleData>;

/**
 * Sample console data for the two tournaments the sample organizer runs
 * that have a bracket to prepare. Everything is a sample; the real read
 * returns the organizer's own tournament or null.
 */
export const sampleConsole = (id: string): ConsoleData | null => {
  const tournament = sampleTournaments.find((item) => item.id === id);
  if (tournament?.id === 'autumn-open')
    return {
      ...base,
      tournament,
      entrants: entrantsFor(tournament.entered),
      outcomes: autumnOutcomes,
      roundsDone: 0,
      defaultRound: 'setup',
    };
  if (tournament?.id === 'harvest-cup')
    return {
      ...base,
      tournament,
      entrants: entrantsFor(tournament.entered),
      outcomes: harvestOutcomes,
      roundsDone: 1,
      defaultRound: 'running',
      withdrawn: 0,
    };
  return null;
};
