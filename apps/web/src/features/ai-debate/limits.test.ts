import { aiDebateLongestMs } from '@daisy/debate-engine';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { setup } from './operations.test-support';

setupRitewayBun();

const create = (
  operations: ReturnType<typeof setup>['operations'],
  actorId: string,
) =>
  operations.start({
    actorId,
    resolution: 'Schools should ban phones in class.',
    personSide: 'affirmative',
    opponent: 'wren',
  });

describe('AI debate limits', () => {
  test('a debate must start within its start window', async () => {
    const { operations, store, time } = setup();
    const { id } = await create(operations, 'actor-1');
    time.advance(15 * 60 + 1);
    await assertRejects({
      given: 'a start 15 minutes and a second after the debate was created',
      should: 'refuse with CONFLICT',
      actual: () =>
        operations.command({
          actorId: 'actor-1',
          id,
          command: { type: 'start' },
          expectedSequence: 0,
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused late start',
      should: 'leave the log empty',
      actual: store.records.get(id)?.commands.length,
      expected: 0,
    });
  });

  test('an unstarted debate holds a seat only for its start window', async () => {
    const { operations, store, time } = setup();
    const { id } = await create(operations, 'actor-1');
    const created = store.records.get(id)!.expectedEndAt.getTime();
    time.advance(60);
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'start' },
      expectedSequence: 0,
    });
    const started = store.records.get(id)!.expectedEndAt.getTime();
    assert({
      given: 'a debate created, then started a minute later',
      should:
        'hold its seat 15 minutes until it starts, then until the longest debate from the start',
      actual: { held: started - created, window: created },
      expected: {
        held: 60_000 + aiDebateLongestMs() - 15 * 60_000,
        window: Date.UTC(2026, 9, 3, 18, 15, 0),
      },
    });
  });

  test('one live debate per person, the global cap and the daily cap', async () => {
    const { operations, store } = setup({ limits: { live: 2, perDay: 3 } });
    const first = await create(operations, 'actor-1');
    const second = await create(operations, 'actor-1');
    assert({
      given: 'a person starting a second debate',
      should: 'finish their first, so they hold one live seat',
      actual: [
        store.records.get(first.id)?.finishedAt !== null,
        store.records.get(second.id)?.finishedAt,
      ],
      expected: [true, null],
    });
    await create(operations, 'actor-2');
    await assertRejects({
      given: 'two people already debating and a live cap of two',
      should: 'refuse a third person with RATE_LIMIT',
      actual: () => create(operations, 'actor-3'),
      code: 'RATE_LIMIT',
    });
    await create(operations, 'actor-1');
    const before = store.records.size;
    await assertRejects({
      given:
        'a person who started three debates today and a daily cap of three',
      should: 'refuse a fourth with RATE_LIMIT and write nothing',
      actual: () => create(operations, 'actor-1'),
      code: 'RATE_LIMIT',
    });
    assert({
      given: 'the refusal',
      should: 'add no debate',
      actual: store.records.size,
      expected: before,
    });
  });
});
