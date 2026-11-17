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
        'name the header (details, close), readiness, settings, capture, sides, visibility and leave forms, six intents per seat and the three format forms',
      actual: {
        header: built.header,
        readiness: built.readiness,
        settings: built.settings,
        capture: built.capture,
        sides: built.sides,
        visibility: built.visibility,
        leave: built.leave,
        seats: built.seats.length,
        format: built.format,
        distinct: new Set([
          built.header.details,
          built.header.close,
          ...Object.values(built.readiness),
          built.settings,
          built.capture,
          built.sides,
          built.visibility,
          built.leave,
          ...built.seats.flatMap((seat) => Object.values(seat)),
          ...Object.values(built.format),
        ]).size,
      },
      expected: {
        header: { details: 'c-1', close: 'c-2' },
        readiness: { ready: 'c-3', unready: 'c-4', 'start-round': 'c-5' },
        settings: 'c-6',
        capture: 'c-46',
        sides: 'c-47',
        visibility: 'c-48',
        leave: 'c-49',
        seats: 6,
        format: { choose: 'c-43', reset: 'c-44', template: 'c-45' },
        distinct: 10 + 6 * 6 + 3,
      },
    });
  });
});
