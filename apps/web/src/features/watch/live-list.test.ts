import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { WatchRound } from './round';
import { defaultLiveQuery } from './live-query';
import { buildLiveListing, featuredRound, isListedLive } from './live-list';

setupRitewayBun();

const seat = (handle: string, rating: number) =>
  ({ handle, rating, standing: 'established' }) as const;

const live = (
  id: string,
  over: Partial<WatchRound> = {},
  watching = 10,
): WatchRound => ({
  id,
  title: id,
  mode: 'ranked',
  customRules: false,
  visibility: 'public',
  aff: seat(`${id}-aff`, 1500),
  neg: seat(`${id}-neg`, 1500),
  judges: [],
  removedSpectators: [],
  audienceFull: false,
  state: { status: 'live', turnIndex: 0, speechSecondsLeft: 100, watching },
  ...over,
});

const ids = (list: readonly WatchRound[]) => list.map((d) => d.id);

describe('live listing', () => {
  test('only public live Rounds are listed', () => {
    assert({
      given: 'public, unlisted, private and ended Rounds',
      should: 'list the public live one only',
      actual: [
        isListedLive(live('a')),
        isListedLive(live('b', { visibility: 'unlisted' })),
        isListedLive(live('c', { visibility: 'private' })),
        isListedLive(
          live('d', {
            state: { status: 'upcoming', affReady: true, negReady: true },
          }),
        ),
      ],
      expected: [true, false, false, false],
    });
  });

  test('the featured Round is the highest-rated ranked one', () => {
    const rounds = [
      live('low', { aff: seat('l1', 1400), neg: seat('l2', 1400) }),
      live('top', { aff: seat('t1', 1700), neg: seat('t2', 1600) }),
      live('casual', {
        mode: 'casual',
        aff: seat('c1', 1900),
        neg: seat('c2', 1900),
      }),
    ];
    assert({
      given: 'a casual Round with higher ratings than any ranked one',
      should: 'feature the best ranked Round, by rating alone',
      actual: featuredRound(rounds)?.id,
      expected: 'top',
    });
    assert({
      given: 'no ranked Round live',
      should: 'feature nothing',
      actual: featuredRound([rounds[2] as WatchRound]),
      expected: null,
    });
  });

  test('the feature leaves the rows and sorting applies to them', () => {
    const rounds = [
      live('top', { aff: seat('t1', 1700), neg: seat('t2', 1700) }, 5),
      live('busy', {}, 50),
      live('quiet', { aff: seat('q1', 1650), neg: seat('q2', 1650) }, 2),
    ];
    const watched = buildLiveListing(rounds, defaultLiveQuery);
    const rated = buildLiveListing(rounds, {
      ...defaultLiveQuery,
      sort: 'rated',
    });
    assert({
      given: 'three live Rounds',
      should: 'feature one and order the rest by the sort',
      actual: [
        watched.featured?.id,
        ids(watched.rows),
        ids(rated.rows),
        watched.total,
      ],
      expected: ['top', ['busy', 'quiet'], ['quiet', 'busy'], 3],
    });
  });

  test('mode and search filter the feature and the rows', () => {
    const rounds = [
      live('top', { aff: seat('t1', 1700), neg: seat('t2', 1700) }),
      live('friendly', { mode: 'casual', title: 'Friendly spar' }),
    ];
    const casual = buildLiveListing(rounds, {
      ...defaultLiveQuery,
      mode: 'casual',
    });
    const search = buildLiveListing(rounds, { ...defaultLiveQuery, q: 'T2' });
    const none = buildLiveListing(rounds, { ...defaultLiveQuery, q: 'zzz' });
    assert({
      given: 'a casual filter, a handle search and a search matching nothing',
      should: 'filter feature and rows together, keeping the total',
      actual: [
        casual.featured,
        ids(casual.rows),
        search.featured?.id,
        ids(search.rows),
        none.featured,
        none.rows.length,
        none.total,
      ],
      expected: [null, ['friendly'], 'top', [], null, 0, 2],
    });
  });
});
