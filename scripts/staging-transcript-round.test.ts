import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { roomCreateSchema } from '@daisy/protocol';
import {
  stagingProofCast,
  stagingProofSelection,
} from './staging-transcript-round';

setupRitewayBun();
test('the staging proof posts the foundation format itself, not a catalog entry', () => {
  const parsed = roomCreateSchema.safeParse({
    commandId: 'cmd1x2y3z4a5b6c7d8e9f0g1',
    title: 'Staging transcript provider proof',
    resolution: { kind: 'custom', text: 'Cities should fund transit' },
    visibility: 'unlisted',
    selection: stagingProofSelection(),
  });
  assert({
    given: 'the catalog no longer offering the foundation format (FMT-1)',
    should: 'post a valid custom selection with one judge seat',
    actual:
      parsed.success && parsed.data.selection.kind === 'custom'
        ? parsed.data.selection.definition.seats
        : parsed.error?.issues,
    expected: { affirmative: 1, negative: 1, judge: 1 },
  });
});
test('the staging proof seats bot debaters on the sides and the AI judge on the bench', () => {
  const judge = { actorId: 'panel', seatRole: 'judge' };
  const debaters = ['first', 'second'].map((actorId) => ({
    actorId,
    seatRole: 'debater',
  }));
  assert({
    given: 'a catalog listing the AI judge ahead of the bot debaters',
    should: 'seat each actor only where its seat role fits (ISSUE-750)',
    actual: stagingProofCast([judge, ...debaters]),
    expected: [
      { role: 'affirmative', actorId: 'first' },
      { role: 'negative', actorId: 'second' },
      { role: 'judge', actorId: 'panel' },
    ],
  });
  expect(() => stagingProofCast(debaters)).toThrow(
    'Staging proof catalog unavailable',
  );
});
