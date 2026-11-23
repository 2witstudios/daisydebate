import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpointFor } from '@daisy/protocol/round';
import { twoSides } from '@daisy/protocol/seats';
import { readableCheckpoint } from './launched-round-read';

setupRitewayBun();

const emptyRuntimeCheckpoint = emptyRuntimeCheckpointFor({ sides: twoSides });

describe('readableCheckpoint', () => {
  test('a stored checkpoint that no longer parses', () => {
    assert({
      given: 'a valid checkpoint, a malformed one and none',
      should: 'keep the valid one and read the others as no live position',
      actual: [
        readableCheckpoint(emptyRuntimeCheckpoint),
        readableCheckpoint({ version: 1, prep_consumed_ms: 'lots' }),
        readableCheckpoint(null),
      ],
      expected: [emptyRuntimeCheckpoint, null, null],
    });
  });
});
