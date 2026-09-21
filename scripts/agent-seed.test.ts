import { restoreDebateRuntime } from '@daisy/debate-engine';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { agentSeedDebate, agentSeedVersion } from './agent-seed';

setupRitewayBun();

describe('agentSeedDebate', () => {
  test('stores a snapshot the engine can restore', () => {
    // restoreDebateRuntime is the public path that parses with the protocol
    // debateSnapshotSchema, and the one the web proof operation uses on load.
    assert({
      given: 'the seeded debate snapshot',
      should: 'restore to the same snapshot through the protocol contract',
      actual: restoreDebateRuntime(agentSeedDebate.snapshot).snapshot(),
      expected: {
        ...agentSeedDebate.snapshot,
        participants: [...agentSeedDebate.snapshot.participants],
      },
    });
  });

  test('keeps the searchable columns in agreement with the snapshot', () => {
    assert({
      given: 'the seeded debate row and its snapshot',
      should: 'carry the same id, resolution, and format in both places',
      actual: {
        id: agentSeedDebate.debateId,
        resolution: agentSeedDebate.resolution,
        format: agentSeedDebate.format,
      },
      expected: {
        id: agentSeedDebate.snapshot.id,
        resolution: agentSeedDebate.snapshot.resolution,
        format: agentSeedDebate.snapshot.format,
      },
    });
  });

  test('marks the corrected seed content with a new version', () => {
    assert({
      given: 'seed content that changed since agent-seed-v1',
      should: 'advance the durable seed version marker',
      actual: agentSeedVersion,
      expected: 'agent-seed-v2',
    });
  });
});
