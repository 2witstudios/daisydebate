import {
  foundationScenarioIds,
  type DebateScenario,
} from '../scripts/scenario';

/** A started round holds its countdown until the clock reaches the AC. */
const scenario: DebateScenario = {
  name: 'ready-up',
  given: {
    ids: foundationScenarioIds,
  },
  when: [
    { type: 'command', command: { type: 'start' }, actor: null },
    { type: 'tick', atMs: 9_999 }, // one millisecond before the AC opens
  ],
  expect: {
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    status: 'active',
    stage: 'countdown',
    opened: [],
  },
};

export default scenario;
