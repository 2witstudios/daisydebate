import { refuseCapacity } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCachedLiveReads } from './cached-live-reads';
import type { LiveQuery } from './live-query';

setupRitewayBun();

const query = (over: Partial<LiveQuery> = {}): LiveQuery => ({
  tab: 'live',
  mode: 'any',
  q: '',
  lobby: '',
  before: '',
  ...over,
});
const world = (failure?: () => Error) => {
  const state = { nowMs: 0, lists: 0, counts: 0, filters: [] as string[] };
  const reads = createCachedLiveReads({
    clock: { now: () => new Date(state.nowMs).toISOString() },
    store: {
      listLiveBroadcasts: async (input: { filter: { q: string } }) => {
        state.lists += 1;
        state.filters.push(input.filter.q);
        if (failure) throw failure();
        return { rows: [], nextBefore: null };
      },
      countLiveBroadcasts: async ({ lobbyId }: { lobbyId?: string }) => {
        state.counts += 1;
        return lobbyId === undefined ? 4 : 0;
      },
    } as never,
  });
  return { state, reads };
};

test('a crowd on the hub costs one read of each page per interval', async () => {
  const { state, reads } = world();
  await Promise.all([reads.listing(query()), reads.listing(query())]);
  await reads.leading();
  await reads.leading();
  await reads.count();
  state.nowMs = 4999;
  await reads.listing(query());
  await reads.leading();
  assert({
    given: 'repeat asks inside the interval',
    should: 'read the page, the lead and the count once each',
    actual: [state.lists, state.counts],
    expected: [2, 2],
  });
  state.nowMs = 5000;
  await reads.listing(query());
  assert({
    given: 'the interval over',
    should: 'read again',
    actual: state.lists,
    expected: 3,
  });
});

test('global and empty-selection counts have separate cache keys', async () => {
  for (const [first, second] of [
    [undefined, ''],
    ['', undefined],
  ] as const) {
    const { reads, state } = world();
    const results = [await reads.count(first), await reads.count(second)];
    const cached = [await reads.count(first), await reads.count(second)];
    const expected = first === undefined ? [4, 0] : [0, 4];
    assert({
      given:
        first === undefined
          ? 'the global count first'
          : 'the empty selection first',
      should: 'read and cache the two counts separately',
      actual: { results, cached, calls: state.counts },
      expected: { results: expected, cached: expected, calls: 2 },
    });
  }
});

test('one search is never answered with another', async () => {
  const { state, reads } = world();
  await reads.listing(query({ q: 'free trade' }));
  await reads.listing(query({ q: 'tax' }));
  assert({
    given: 'two different searches',
    should: 'read each',
    actual: state.filters,
    expected: ['free trade', 'tax'],
  });
});

test('a refused page is asked once per interval', async () => {
  const { state, reads } = world(() =>
    refuseCapacity({ lane: 'audience', reason: 'saturated' }),
  );
  const refusal = async () =>
    reads.listing(query()).then(
      () => false,
      () => true,
    );
  assert({
    given: 'two asks while the audience lane is full',
    should: 'refuse both and try once',
    actual: [await refusal(), await refusal(), state.lists],
    expected: [true, true, 1],
  });
});
