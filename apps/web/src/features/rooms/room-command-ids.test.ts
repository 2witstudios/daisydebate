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
        'name the header (details, leave, close), readiness, prep and settings forms and four intents per seat',
      actual: {
        header: built.header,
        readiness: built.readiness,
        prep: built.prep,
        settings: built.settings,
        seats: built.seats.length,
        distinct: new Set([
          built.header.details,
          built.header.leave,
          built.header.close,
          ...Object.values(built.readiness),
          ...Object.values(built.prep),
          built.settings,
          ...built.seats.flatMap((seat) => Object.values(seat)),
        ]).size,
      },
      expected: {
        header: { details: 'c-1', leave: 'c-2', close: 'c-3' },
        readiness: { ready: 'c-4', unready: 'c-5', 'start-round': 'c-6' },
        prep: { start: 'c-7', finish: 'c-8' },
        settings: 'c-9',
        seats: 6,
        distinct: 9 + 6 * 4,
      },
    });
  });
});
