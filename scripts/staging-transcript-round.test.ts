import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { roomCreateSchema } from '@daisy/protocol/room-contract';
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
    expected: {
      sides: { affirmative: 1, negative: 1 },
      speakers: 0,
      judges: 1,
      moderators: 0,
    },
  });
});
test('the staging proof seats bot debaters on the sides and the AI judge on the bench', () => {
  const judge = { actorId: 'panel', seatKind: 'judge' } as const;
  const debaters = ['first', 'second'].map((actorId) => ({
    actorId,
    seatKind: 'side' as const,
  }));
  assert({
    given: 'a catalog listing the AI judge ahead of the bot debaters',
    should: 'seat each actor only where its seat kind fits (ISSUE-750)',
    actual: stagingProofCast([judge, ...debaters]),
    expected: [
      {
        seat: { kind: 'side', side: 'affirmative', slot: 0 },
        actorId: 'first',
      },
      {
        seat: { kind: 'side', side: 'negative', slot: 0 },
        actorId: 'second',
      },
      { seat: { kind: 'judge', slot: 0 }, actorId: 'panel' },
    ],
  });
  expect(() => stagingProofCast(debaters)).toThrow(
    'Staging proof catalog unavailable',
  );
});
