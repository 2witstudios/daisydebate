import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveRow } from './live-card.test-support';
import {
  leadingLive,
  listLive,
  liveRoundsOf,
  type LiveStore,
} from './list-live';
import { defaultLiveQuery } from './live-query';

setupRitewayBun();

const NOW = '2026-11-02T00:10:00.000Z';
const casual = liveRow({ id: 'casual', competitionType: 'casual' });
const ranked = liveRow({ id: 'ranked' });
const store = (rows = [casual, ranked], seen: unknown[] = []): LiveStore => ({
  listLiveBroadcasts: (input) => {
    seen.push(input);
    return Promise.resolve({ rows, nextBefore: 'next' });
  },
  countLiveBroadcasts: () => Promise.resolve(7),
});

describe('listLive', () => {
  test('a first page', async () => {
    const listing = await listLive(store(), {
      query: defaultLiveQuery,
      now: NOW,
    });
    assert({
      given: 'a ranked and a casual Round on the first page',
      should: 'feature the ranked one once, and carry the total and cursor',
      actual: [
        listing.featured?.id,
        listing.rows.map((row) => row.id),
        listing.total,
        listing.nextBefore,
      ],
      expected: ['ranked', ['casual'], 7, 'next'],
    });
  });

  test('a later page', async () => {
    const listing = await listLive(store(), {
      query: { ...defaultLiveQuery, before: 'cursor' },
      now: NOW,
    });
    assert({
      given: 'a later page',
      should: 'feature nothing',
      actual: [listing.featured, listing.rows.length],
      expected: [null, 2],
    });
  });

  test('filters reach the read, with the ranked delay in force', async () => {
    const seen: unknown[] = [];
    await listLive(store([], seen), {
      query: { ...defaultLiveQuery, mode: 'casual', q: 'ana' },
      now: NOW,
    });
    assert({
      given: 'a mode and a search',
      should: 'ask the store for them under the release clock',
      actual: seen,
      expected: [
        {
          filter: { mode: 'casual', q: 'ana' },
          before: '',
          clock: { now: NOW, rankedDelaySeconds: 60 },
          limit: 24,
        },
      ],
    });
  });
});

describe('entry points', () => {
  test('the home page', async () => {
    assert({
      given: 'live Rounds',
      should: 'lead with real cards',
      actual: (await leadingLive(store(), NOW)).map((card) => card.id),
      expected: ['casual', 'ranked'],
    });
  });

  test('a person', async () => {
    const seen: unknown[] = [];
    const live = await liveRoundsOf(store([ranked], seen), {
      usernames: ['ana', 'bea'],
      now: NOW,
    });
    assert({
      given: 'two names, one of them seated in a live Round',
      should: 'map only that name to the Round',
      actual: [[...live.keys()], live.get('ana')?.id],
      expected: [['ana'], 'ranked'],
    });
    assert({
      given: 'no names',
      should: 'not read at all',
      actual: (await liveRoundsOf(store([], seen), { usernames: [], now: NOW }))
        .size,
      expected: 0,
    });
  });
});
