import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sequentialId } from '@daisy/clock';
import { assemblySnapshot } from './assembly.test-support';
import { roomCommandIds } from './room-command-ids';

setupRitewayBun();

describe('roomCommandIds', () => {
  test('one identifier per form the room renders', () => {
    const ids = sequentialId('c');
    const built = roomCommandIds(assemblySnapshot, () => ids.next());
    assert({
      given:
        'a room declaring two affirmative, three negative and one judge seat',
      should:
        'name the header, readiness, prep and settings forms and four intents per seat',
      actual: {
        header: built.header,
        readiness: built.readiness,
        prep: built.prep,
        settings: built.settings,
        seats: built.seats.length,
        distinct: new Set([
          built.header.details,
          built.header.leave,
          ...Object.values(built.readiness),
          ...Object.values(built.prep),
          built.settings,
          ...built.seats.flatMap((seat) => Object.values(seat)),
        ]).size,
      },
      expected: {
        header: { details: 'c-1', leave: 'c-2' },
        readiness: { ready: 'c-3', unready: 'c-4', 'start-round': 'c-5' },
        prep: { start: 'c-6', finish: 'c-7' },
        settings: 'c-8',
        seats: 6,
        distinct: 8 + 6 * 4,
      },
    });
  });
});
