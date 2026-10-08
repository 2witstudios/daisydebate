import {
  foundationScenarioIds,
  type DebateScenario,
} from '../scripts/scenario';

/** A command the round's stage refuses leaves the rows exactly as they were. */
const scenario: DebateScenario = {
  name: 'rejection-atomicity',
  given: {
    ids: foundationScenarioIds,
  },
  when: [
    { type: 'command', command: { type: 'start' }, actor: null },
    { type: 'tick', atMs: 10_000 }, // the AC opens
    {
      type: 'expect-rejection',
      operation: {
        type: 'command',
        command: { type: 'start_speech' },
        actor: 1,
      },
      invariantId: 'round.speech.requires-prep',
    },
  ],
  expect: {
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    status: 'active',
    stage: 'live',
    opened: ['AC'],
  },
};

export default scenario;
