import type { DebateScenario, ScenarioAction } from '../scripts/scenario';

/** Advances the clock to `atMs`, then acts as the 1-based seat `actor`. */
const at = (
  atMs: number,
  type: 'yield' | 'interrupt' | 'start_prep' | 'start_speech',
  actor: number,
): ScenarioAction[] => [
  { type: 'tick', atMs },
  { type: 'command', command: { type }, actor },
];

/**
 * A judged one-on-one (seats: 1 affirmative, 2 negative, 3 judge) is played
 * through its seven segments by the debaters' own commands: yields, an
 * interruption of the first cross-examination and negative prep before the
 * constructive. A ballot before the final segment ends is refused without
 * changing the Round; the judge's ballot afterwards decides the outcome
 * through the engine's ruling, which completes the Round.
 */
const scenario: DebateScenario = {
  name: 'judge-flow',
  given: {
    format: 'one-on-one',
    ids: [
      'k2v9x0f4m8q3w1z7c5n6b4d2',
      // Actors, then seats: affirmative, negative, judge.
      'a7b3c9d1e5f2k4m6n8p1r3t5',
      'c8d4e2f6a1b3k5m7n9p2r4t6',
      'q4w6e8r1t3y5u7i9o2p4a6s8',
      'd5e8f2a4c6b1k3m7n9p2r4t6',
      'f1a3b5c7d9e2f4a6b8c1d3e5',
      'z1x3c5v7b9n2m4l6k8j1h3g5',
      // The seven segment rows, in the order they open.
      'a1b2c3d4e5f6a7b8c9d0e1f2',
      'e1f2a3b4c5d6e7f8a9b0c1d2',
      'b0c1d2e3f4a5b6c7d8e9f0a1',
      'm2n4p6q8r1s3t5u7v9w2x4y6',
      'g3h5j7k9l2m4n6p8q1r3s5t7',
      'u8v1w3x5y7z9a2b4c6d8e1f3',
      'h6j8k1l3m5n7p9q2r4s6t8v1',
    ],
  },
  when: [
    { type: 'command', command: { type: 'start' }, actor: null },
    { type: 'tick', atMs: 10_000 }, // AC opens
    ...at(60_000, 'yield', 1), // AC ends early
    { type: 'tick', atMs: 70_000 }, // CX1 opens, the negative asking
    ...at(80_000, 'interrupt', 1), // the affirmative takes the floor
    ...at(90_000, 'yield', 1), // and ends CX1
    ...at(95_000, 'start_prep', 2), // the negative preps for NC
    ...at(125_000, 'start_speech', 2), // NC opens out of prep
    {
      type: 'expect-rejection',
      operation: {
        type: 'ballots',
        rulings: [{ judge: 3, winner: 'negative' }],
      },
      invariantId: 'round.complete.after-final-segment',
    },
    ...at(185_000, 'yield', 2), // NC ends
    { type: 'tick', atMs: 195_000 }, // CX2 opens
    ...at(225_000, 'yield', 1),
    { type: 'tick', atMs: 235_000 }, // 1AR opens
    ...at(265_000, 'yield', 1),
    { type: 'tick', atMs: 275_000 }, // NR opens
    ...at(305_000, 'yield', 2),
    { type: 'tick', atMs: 315_000 }, // 2AR opens
    ...at(345_000, 'yield', 1), // the final segment ends
    { type: 'ballots', rulings: [{ judge: 3, winner: 'negative' }] },
  ],
  expect: {
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    status: 'completed',
    stage: null,
    outcome: 'negative',
    opened: ['AC', 'CX1', 'NC', 'CX2', '1AR', 'NR', '2AR'],
  },
};

export default scenario;
