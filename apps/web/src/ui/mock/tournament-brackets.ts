import { formatTime, shiftMinutes } from '../../features/tournaments/dates';
import type {
  BracketData,
  EliminationData,
  Match,
  RobinData,
  RobinRound,
  Slot,
} from '../../features/tournaments/bracket';
import { sampleTournaments } from './tournaments';

const slot = (seed: number, handle: string): Slot => ({ seed, handle });

const done = (
  id: string,
  label: string,
  a: Slot,
  b: Slot,
  winner: 'a' | 'b',
  judge: string,
): Match => ({
  id,
  label,
  a,
  b,
  state: 'done',
  winner,
  judge,
  watching: null,
  note: null,
});

const live = (
  id: string,
  label: string,
  a: Slot,
  b: Slot,
  judge: string,
  watching: number,
): Match => ({
  id,
  label,
  a,
  b,
  state: 'live',
  winner: null,
  judge,
  watching,
  note: null,
});

const table = (
  n: number,
  a: string,
  b: string,
  winner: 'a' | 'b' | null = null,
) => ({ table: n, a: `debater-${a}`, b: `debater-${b}`, winner });

/** Sample round robin: rounds 1 and 2 played, 3 out, 4 to 7 scheduled. */
const robinRounds: readonly RobinRound[] = [
  {
    number: 1,
    state: 'done',
    note: 'Done',
    tables: [
      table(1, 'a', 'j', 'a'),
      table(2, 'b', 'i', 'a'),
      table(3, 'c', 'h', 'a'),
      table(4, 'd', 'g', 'a'),
    ],
  },
  {
    number: 2,
    state: 'done',
    note: 'Done',
    tables: [
      table(1, 'a', 'i', 'a'),
      table(2, 'j', 'h', 'a'),
      table(3, 'g', 'b', 'a'),
      table(4, 'd', 'c', 'a'),
    ],
  },
  {
    number: 3,
    state: 'out',
    note: 'Pairings out, 16:00',
    tables: [
      table(1, 'a', 'h'),
      table(2, 'i', 'g'),
      table(3, 'j', 'd'),
      table(4, 'b', 'c'),
    ],
  },
  {
    number: 4,
    state: 'scheduled',
    note: 'Scheduled',
    tables: [
      table(1, 'a', 'g'),
      table(2, 'b', 'j'),
      table(3, 'c', 'i'),
      table(4, 'd', 'h'),
    ],
  },
  {
    number: 5,
    state: 'scheduled',
    note: 'Scheduled',
    tables: [
      table(1, 'a', 'd'),
      table(2, 'b', 'h'),
      table(3, 'c', 'g'),
      table(4, 'i', 'j'),
    ],
  },
  {
    number: 6,
    state: 'scheduled',
    note: 'Scheduled',
    tables: [
      table(1, 'a', 'c'),
      table(2, 'b', 'd'),
      table(3, 'g', 'j'),
      table(4, 'h', 'i'),
    ],
  },
  {
    number: 7,
    state: 'scheduled',
    note: 'Scheduled',
    tables: [
      table(1, 'a', 'b'),
      table(2, 'c', 'j'),
      table(3, 'd', 'i'),
      table(4, 'g', 'h'),
    ],
  },
];

/**
 * Sample brackets for the two in-progress tournaments. Handles, seeds and
 * judges are samples. Tournaments that have not started return null.
 */
export const sampleBracket = (id: string, now: string): BracketData | null => {
  const tournament = sampleTournaments.find((item) => item.id === id);
  if (tournament?.id === 'harvest-cup') return harvest(tournament, now);
  if (tournament?.id === 'club-championship') return club(tournament, now);
  return null;
};

function harvest(
  tournament: EliminationData['tournament'],
  now: string,
): EliminationData {
  const c = slot(1, 'debater-c');
  const d = slot(2, 'debater-d');
  const g = slot(3, 'debater-g');
  const a = slot(4, 'debater-a');
  const b = slot(5, 'debater-b');
  const h = slot(6, 'debater-h');
  const i = slot(7, 'debater-i');
  const j = slot(8, 'debater-j');
  return {
    kind: 'elimination',
    tournament,
    liveLine: `Semifinals in progress. Next: Final today, ${formatTime(shiftMinutes(now, 150))}.`,
    updatedAt: now,
    rounds: [
      {
        label: 'Quarterfinals',
        matches: [
          done('qf1', 'Quarterfinal 1', c, j, 'a', 'judge-m'),
          done('qf2', 'Quarterfinal 2', a, b, 'a', 'judge-n'),
          done('qf3', 'Quarterfinal 3', g, h, 'a', 'judge-p'),
          done('qf4', 'Quarterfinal 4', d, i, 'b', 'judge-q'),
        ],
      },
      {
        label: 'Semifinals',
        matches: [
          live('sf1', 'Semifinal 1', c, a, 'judge-k', 31),
          live('sf2', 'Semifinal 2', g, i, 'judge-r', 12),
        ],
      },
      {
        label: 'Final',
        matches: [
          {
            id: 'f',
            label: 'Final',
            a: null,
            b: null,
            state: 'pending',
            winner: null,
            judge: null,
            watching: null,
            note: `Today, ${formatTime(shiftMinutes(now, 150))}`,
          },
        ],
      },
    ],
  };
}

function club(tournament: RobinData['tournament'], now: string): RobinData {
  return {
    kind: 'round-robin',
    tournament,
    handles: ['a', 'b', 'c', 'd', 'g', 'h', 'i', 'j'].map(
      (x) => `debater-${x}`,
    ),
    rounds: robinRounds,
    liveLine: `Round 3 of 7 begins at ${formatTime(shiftMinutes(now, 240))}. Pairings are out.`,
    updatedAt: now,
    times: { 3: formatTime(shiftMinutes(now, 240)) },
  };
}
