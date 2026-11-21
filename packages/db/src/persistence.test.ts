import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Database } from './index';
import { validRules } from './testing-rules';
import {
  emptyRuntimeCheckpointFor,
  type RoundProjection,
} from '@daisy/protocol';

setupRitewayBun();

const checkpoint = emptyRuntimeCheckpointFor(validRules);
const activeCountdownProjection: RoundProjection = {
  round: {
    status: 'active',
    currentStage: 'countdown',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    outcome: null,
    checkpoint,
  },
  segmentInserts: [],
  segmentCloses: [],
  effects: [],
};
test('Round projection callbacks are synchronous pure execution seams', () => {
  type BuildProjection = Parameters<
    Database['executeRoundCommand']
  >[0]['buildProjection'];
  // @ts-expect-error A callback cannot perform asynchronous I/O while holding the transaction.
  const asynchronous: BuildProjection = async () => activeCountdownProjection;
  assert({
    given: 'the public Round execution callback type',
    should: 'exclude async callbacks at compile time',
    actual: typeof asynchronous,
    expected: 'function',
  });
});
