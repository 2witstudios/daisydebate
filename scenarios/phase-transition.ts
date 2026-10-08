import {
  foundationScenarioIds,
  type DebateScenario,
} from '../scripts/scenario';

/** The round runs stage by stage to the final segment, awaiting its ballot. */
const scenario: DebateScenario = {
  name: 'phase-transition',
  given: {
    ids: foundationScenarioIds,
  },
  when: [
    { type: 'command', command: { type: 'start' }, actor: null },
    { type: 'tick', atMs: 10_000 },
    { type: 'tick', atMs: 260_000 },
    { type: 'tick', atMs: 500_000 }, // the NC spoken out, ballot pending
  ],
  expect: {
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    status: 'active',
    stage: 'live',
    opened: ['AC', 'NC'],
  },
};

export default scenario;
