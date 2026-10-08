import {
  foundationScenarioIds,
  type DebateScenario,
} from '../scripts/scenario';

/**
 * The judge's ballot is a durable row written with round completion,
 * not a runtime command: the runtime receives only the
 * completed round's outcome. A scenario that reads and writes ballots
 * needs the persistence adapter, which this runner does not drive.
 */
const scenario: DebateScenario = {
  name: 'judge-flow',
  given: {
    ids: foundationScenarioIds,
  },
  when: [],
  unsupported:
    'The scenario runner drives the pure runtime only. Ballots live in the durable rows, so a judge-flow scenario belongs to the integration suite; encode it there with atomic round completion.',
  expect: {
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    status: 'scheduled',
    stage: null,
    opened: [],
  },
};

export default scenario;
