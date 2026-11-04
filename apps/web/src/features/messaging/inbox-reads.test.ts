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
function world(initialPages = 1) {
  const timers: { work: () => void; ms: number }[] = [];
  const reads: {
    q: string | null;
    after: string | null;
    answer: (page: MessagingInboxPageAnswer | null) => void;
    fail: () => void;
  }[] = [];
  const firsts: (string | null)[] = [];
  const nexts: (string | null)[] = [];
  let shown: readonly string[] = [];
  const reader = createInboxReads({
    initialPages,
    readPage: (query) =>
      new Promise((resolve, reject) =>
        reads.push({
          ...query,
          answer: resolve,
          fail: () => reject(new Error('down')),
        }),
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
    onRefreshed: (page) => {
      firsts.push(page.nextAfter);
      shown = page.entries.map((entry) => entry.channelId);
    },
    onNextPage: (page) => nexts.push(page.nextAfter),
  });
  const tick = () => timers.shift()?.work();
  return { reader, timers, reads, firsts, nexts, tick, shown: () => shown };
}

describe('inbox reads', () => {
  test('refresh spacing covers the loaded read work', () => {
    const w = world(3);
    w.reader.ring();
    assert({
      given: 'three loaded pages sharing the account read budget',
      should: 'space refreshes by the work of all three pages',
      actual: w.timers.map((timer) => timer.ms),
      expected: [2250],
    });
  });
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
  test('a ring re-reads every loaded page, so one that left goes', async () => {
    const entry = (channelId: string) =>
      ({
        channelId,
        kind: 'conversation',
        title: channelId,
        preview: null,
        activityAt: '2026-11-04T10:00:00.000Z',
        unread: false,
      }) as const;
    const w = world(2);
    w.reader.ring();
    w.tick();
    await settle();
    w.reads[0]!.answer({ entries: [entry('page-one')], nextAfter: 'one' });
    await settle();
    assert({
      given: 'a refresh of two loaded pages, the first answered',
      should: 'apply nothing yet and read the second from its cursor',
      actual: [w.firsts, w.reads[1]?.after],
      expected: [[], 'one'],
    });
    // The conversation that was on page two was revoked: it is simply absent.
    w.reads[1]!.answer({ entries: [], nextAfter: null });
    await settle();
    assert({
      given: 'a second page no longer holding a revoked conversation',
      should: 'replace everything shown with the authoritative answer',
      actual: [w.shown(), w.firsts],
      expected: [['page-one'], [null]],
    });
  });
  test('one failed page keeps the whole list as shown', async () => {
    const w = world(2);
    w.reader.ring();
    w.tick();
    await settle();
    w.reads[0]!.answer({ entries: [], nextAfter: 'one' });
    await settle();
    w.reads[1]!.fail();
    await settle();
    assert({
      given: 'a refresh whose later page fails',
      should: 'apply no part of it',
      actual: w.firsts,
      expected: [],
    });
  });
  test('a page loaded during a refresh makes it ask again', async () => {
    const w = world(1);
    w.reader.ring();
    w.tick();
    await settle();
    const more = w.reader.more('cursor');
    await settle();
    w.reads[1]!.answer(answer(null));
    await more;
    w.reads[0]!.answer(answer('stale-coverage'));
    await settle();
    w.tick();
    await settle();
    assert({
      given: 'a refresh that began before a page was added',
      should: 'discard it and re-read both pages',
      actual: [w.firsts, w.reads.length],
      expected: [[], 3],
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
