import {
  foundationScenarioIds,
  type DebateScenario,
} from '../scripts/scenario';

/** A scheduled foundation round starts, speaks its two speeches, completes. */
const scenario: DebateScenario = {
  name: 'foundation-lifecycle',
  given: {
    ids: foundationScenarioIds,
  },
  when: [
    { type: 'start-round' },
    { type: 'tick', atMs: 10_000 }, // the AC opens
    { type: 'tick', atMs: 250_000 }, // the AC closes; the NC countdown runs
    { type: 'tick', atMs: 260_000 }, // the NC opens
    { type: 'tick', atMs: 500_000 }, // the NC's time is spent
    { type: 'ballots', rulings: [] }, // no judge seats: unjudged
  ],
  expect: {
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    status: 'completed',
    stage: null,
    outcome: null,
    opened: ['AC', 'NC'],
  },
};

export default scenario;
