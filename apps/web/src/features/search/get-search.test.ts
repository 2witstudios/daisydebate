import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getRoomInfo } from '../rooms/get-room';
import { getSearch } from './get-search';

setupRitewayBun();

const now = '2026-10-03T12:00:00.000Z';

describe('getSearch', () => {
  test('a name in the sample data', () => {
    const results = getSearch({ q: 'tuesday' }, now);
    assert({
      given: 'a query that names a sample room',
      should: 'find it under rooms',
      actual: results.groups.some((group) => group.kind === 'room'),
      expected: true,
    });
  });

  test('no query', () => {
    assert({
      given: 'no query',
      should: 'return no hits',
      actual: getSearch({}, now).total,
      expected: 0,
    });
  });

  test('every room hit is a room that exists', () => {
    const groups = getSearch({ q: 'a' }, now).groups;
    const rooms = groups.find((group) => group.kind === 'room')?.items ?? [];
    assert({
      given: 'a broad search that matches rooms, including live ones',
      should:
        'offer only rooms with a room page, never a live room that would 404',
      actual: [
        rooms.length > 0,
        rooms.every(
          (room) => getRoomInfo(room.href.replace('/rooms/', ''), now) !== null,
        ),
        getSearch({ q: 'serious only' }, now).groups.some(
          (group) => group.kind === 'room',
        ),
      ],
      expected: [true, true, false],
    });
  });
});
