import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createInboxReads } from './inbox-reads';
import type { MessagingInboxPageAnswer } from './inbox-view';

setupRitewayBun();
const answer = (nextAfter: string | null): MessagingInboxPageAnswer => ({
  entries: [],
  nextAfter,
});
const settle = async () => {
  for (let n = 0; n < 5; n += 1) await Promise.resolve();
};

/** A world whose timers and reads the test releases one at a time. */
function world() {
  const timers: { work: () => void; ms: number }[] = [];
  const reads: {
    q: string | null;
    after: string | null;
    answer: (page: MessagingInboxPageAnswer | null) => void;
    fail: () => void;
  }[] = [];
  const firsts: (string | null)[] = [];
  const nexts: (string | null)[] = [];
  const reader = createInboxReads({
    readPage: (query) =>
      new Promise((resolve, reject) =>
        reads.push({ ...query, answer: resolve, fail: () => reject(new Error('down')) }),
      ),
    scheduler: {
      after: (work, ms) => {
        const timer = { work, ms };
        timers.push(timer);
        return () => {
          timers.splice(timers.indexOf(timer), 1);
        };
      },
    },
    onFirstPage: (page) => firsts.push(page.nextAfter),
    onNextPage: (page) => nexts.push(page.nextAfter),
  });
  const tick = () => timers.shift()?.work();
  return { reader, timers, reads, firsts, nexts, tick };
}

describe('inbox reads', () => {
  test('rings coalesce', async () => {
    const w = world();
    w.reader.ring();
    w.reader.ring();
    w.reader.ring();
    assert({
      given: 'a burst of rings',
      should: 'schedule one read',
      actual: w.timers.length,
      expected: 1,
    });
    w.tick();
    w.reader.ring();
    w.tick();
    w.reader.ring();
    await settle();
    assert({
      given: 'more rings while a read is in flight',
      should: 'never overlap it',
      actual: w.reads.length,
      expected: 1,
    });
    w.reads[0]!.answer(answer('one'));
    await settle();
    w.tick();
    w.tick();
    await settle();
    assert({
      given: 'the in-flight read answered',
      should: 'apply it and ask exactly once more',
      actual: [w.firsts, w.reads.length],
      expected: [['one'], 2],
    });
  });
  test('a stale search answer never applies', async () => {
    const w = world();
    w.reader.search('old');
    w.tick();
    await settle();
    w.reader.search('new');
    w.reads[0]!.answer(answer('stale'));
    await settle();
    assert({
      given: 'an answer to a search since replaced',
      should: 'discard it',
      actual: w.firsts,
      expected: [],
    });
    w.tick();
    await settle();
    assert({
      given: 'the newest search',
      should: 'be asked',
      actual: w.reads.at(-1)?.q,
      expected: 'new',
    });
    w.reads.at(-1)!.answer(answer('fresh'));
    await settle();
    assert({
      given: 'its answer',
      should: 'apply',
      actual: w.firsts,
      expected: ['fresh'],
    });
  });
  test('search debounce', () => {
    const w = world();
    w.reader.search('a');
    w.reader.search('ab');
    w.reader.search('abc');
    assert({
      given: 'typing',
      should: 'wait on one debounce',
      actual: w.timers.map((timer) => timer.ms),
      expected: [250],
    });
  });
  test('a failed read keeps what is shown', async () => {
    const w = world();
    w.reader.ring();
    w.tick();
    await settle();
    w.reads[0]!.fail();
    await settle();
    assert({
      given: 'a read that fails',
      should: 'apply nothing',
      actual: w.firsts,
      expected: [],
    });
  });
  test('a next page from an older search is discarded', async () => {
    const w = world();
    const more = w.reader.more('cursor');
    await settle();
    w.reader.search('new');
    w.reads[0]!.answer(answer('old-page'));
    await more;
    assert({
      given: 'a page answered after the search changed',
      should: 'not append it',
      actual: w.nexts,
      expected: [],
    });
  });
  test('close', async () => {
    const w = world();
    w.reader.ring();
    w.reader.close();
    assert({
      given: 'a closed reader',
      should: 'cancel what was scheduled',
      actual: w.timers.length,
      expected: 0,
    });
  });
});
