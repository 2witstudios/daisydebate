import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { YOUTH_PEOPLE_TTL_MS, youthPeopleCache } from './youth-people-cache';

setupRitewayBun();

const people = { debaters: [] };

describe('youthPeopleCache', () => {
  test('reads a Round once within the window, then again', async () => {
    let nowMs = 0;
    const reads: string[] = [];
    const cached = youthPeopleCache({
      read: async (roundId) => {
        reads.push(roundId);
        return people;
      },
      nowMs: () => nowMs,
    });
    await cached('a');
    await cached('a');
    await cached('b');
    nowMs = YOUTH_PEOPLE_TTL_MS;
    await cached('a');
    assert({
      given:
        'two reads of one Round in the window, another Round, then one after it',
      should: 'read the first Round twice in all and the other once',
      actual: reads,
      expected: ['a', 'b', 'a'],
    });
  });

  test('never keeps a failed read', async () => {
    let fail = true;
    const cached = youthPeopleCache({
      read: async () => {
        if (fail) throw new Error('down');
        return people;
      },
      nowMs: () => 0,
    });
    const first = await cached('a').then(
      () => 'read',
      () => 'failed',
    );
    fail = false;
    assert({
      given: 'a read that failed, then a working store',
      should: 'fail once and then read afresh',
      actual: [first, await cached('a')],
      expected: ['failed', people],
    });
  });
});
