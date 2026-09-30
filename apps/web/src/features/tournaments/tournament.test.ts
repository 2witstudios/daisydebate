import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  bandAccepts,
  isFull,
  statusOf,
  tabOf,
  type Lifecycle,
} from './tournament';
import { tournament } from './tournament.test-support';

setupRitewayBun();

const lifecycles: readonly Lifecycle[] = [
  'announced',
  'registration',
  'registration-closed',
  'in-progress',
  'completed',
];

describe('statusOf and tabOf', () => {
  test('each lifecycle reads as one status on one tab', () => {
    assert({
      given: 'every lifecycle',
      should: 'map to status and tab',
      actual: lifecycles.map((lifecycle) => {
        const item = tournament({ lifecycle });
        return [statusOf(item), tabOf(item)];
      }),
      expected: [
        ['not-open', 'upcoming'],
        ['open', 'open'],
        ['closed', 'upcoming'],
        ['live', 'live'],
        ['done', 'past'],
      ],
    });
  });

  test('a full registration moves to upcoming with a waitlist', () => {
    const full = tournament({ entered: 16 });
    assert({
      given: 'a tournament with every place taken',
      should: 'be full, on the upcoming tab',
      actual: [isFull(full), statusOf(full), tabOf(full)],
      expected: [true, 'full', 'upcoming'],
    });
  });
});

describe('bandAccepts', () => {
  test('both ends are inclusive and null is unbounded', () => {
    const band = { min: 1300, max: 1700 };
    assert({
      given: 'a 1300 to 1700 band and an unbounded one',
      should: 'accept the edges and refuse outside',
      actual: [
        bandAccepts(band, 1300),
        bandAccepts(band, 1700),
        bandAccepts(band, 1299),
        bandAccepts(band, 1701),
        bandAccepts({ min: null, max: null }, 5),
        bandAccepts({ min: 1000, max: null }, 999),
      ],
      expected: [true, true, false, false, true, false],
    });
  });
});
