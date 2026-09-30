import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sortRooms } from './sort';
import { NOW, liveRoom, openRoom } from './room.test-support';
import type { LobbySort } from './query';

setupRitewayBun();

const viewer = { rating: 1400 };
const minutesAgo = (minutes: number) =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
const open = (id: string, rating: number, waited: number) =>
  openRoom({
    id,
    host: { handle: id, rating },
    waitingSince: minutesAgo(waited),
  });
const live = (id: string, rating: number, watching: number) =>
  liveRoom({
    id,
    host: { handle: id, rating },
    opponent: { handle: `${id}-2`, rating },
    watching,
  });

const rooms = [
  open('o1', 1512, 2),
  open('o2', 1180, 6),
  open('o3', 1390, 9),
  live('l1', 1604, 14),
  live('l2', 1250, 3),
];
const order = (sort: LobbySort, list = rooms) =>
  sortRooms(list, sort, viewer, NOW).map((room) => room.id);

describe('sortRooms', () => {
  test('closest to the viewer', () => {
    assert({
      given: 'a 1400 viewer',
      should: 'order by distance from 1400',
      actual: order('closest'),
      // 10, 112, 150, 204, 220
      expected: ['o3', 'o1', 'l2', 'l1', 'o2'],
    });
  });

  test('highest and lowest rating', () => {
    assert({
      given: 'mixed open and live rooms',
      should: 'order by room rating, high to low and low to high',
      actual: [order('high'), order('low')],
      expected: [
        ['l1', 'o1', 'o3', 'l2', 'o2'],
        ['o2', 'l2', 'o3', 'o1', 'l1'],
      ],
    });
  });

  test('waiting longest puts live rooms last', () => {
    assert({
      given: 'open tables that waited 9, 6 and 2 minutes',
      should: 'list the longest wait first and live rooms after the tables',
      actual: order('waiting'),
      expected: ['o3', 'o2', 'o1', 'l1', 'l2'],
    });
  });

  test('newest puts live rooms last', () => {
    assert({
      given: 'open tables that waited 2, 6 and 9 minutes',
      should: 'list the shortest wait first and live rooms after the tables',
      actual: order('newest'),
      expected: ['o1', 'o2', 'o3', 'l1', 'l2'],
    });
  });

  test('most watched puts open tables last', () => {
    assert({
      given: 'live rooms watched by 14 and 3',
      should: 'list the most watched first and open tables after',
      actual: order('watched'),
      expected: ['l1', 'l2', 'o1', 'o2', 'o3'],
    });
  });

  test('ties keep a stable order by id', () => {
    const tied = [open('z', 1400, 5), open('a', 1400, 5), open('m', 1400, 5)];
    assert({
      given: 'rooms that tie on every sort key',
      should: 'order them by id, whatever order they arrived in',
      actual: (
        ['closest', 'high', 'low', 'waiting', 'newest', 'watched'] as const
      ).map((sort) => order(sort, tied)),
      expected: Array.from({ length: 6 }, () => ['a', 'm', 'z']),
    });
  });

  test('the listing is not mutated', () => {
    const before = rooms.map((room) => room.id);
    order('high');
    assert({
      given: 'a sorted listing',
      should: 'leave the source list unchanged',
      actual: rooms.map((room) => room.id),
      expected: before,
    });
  });
});
