import { assert, setupRitewayBun, test } from 'riteway/bun';
import { workKindsOf } from './round-projection-writer';
import type { RoundProjection } from '@daisy/protocol';

setupRitewayBun();

const projection: RoundProjection = {
  round: null,
  segmentInserts: [],
  segmentCloses: [],
  effects: [],
};

test('a Round write wakes the live loops; a completion also wakes rating', () => {
  const completed = {
    ...projection,
    round: { status: 'completed' } as never,
  };
  const ended = {
    ...projection,
    round: { status: 'abandoned' } as never,
  };
  assert({
    given: 'a plain write, a completing write and an abandoning write',
    should: 'send round always, and rating only for the completion',
    actual: [projection, completed, ended].map(workKindsOf),
    expected: [['round'], ['round', 'rating'], ['round']],
  });
});
