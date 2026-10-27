import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sequentialId } from '@daisy/clock';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { roomCommandIds } from '../../../features/rooms/room-command-ids';
import { WithAppRouter } from '../../test-support/app-router';
import type { RoomRefusal } from '@daisy/protocol';
import { RoomLive } from './room-live';

setupRitewayBun();

const render = (refusal: { readonly reason: RoomRefusal | null } | null) => {
  const ids = sequentialId('seed');
  return renderToStaticMarkup(
    h(
      WithAppRouter,
      null,
      h(RoomLive, {
        view: assemblySnapshot,
        ids: roomCommandIds(assemblySnapshot, () => ids.next()),
        actorId: 'v'.repeat(24),
        viewerLabel: 'Viewer',
        bots: [],
        choices: [],
        socketUrl: null,
        refusal,
        commandAction: async () => ({ values: {} }),
        detailsAction: async () => ({ values: {} }),
        settingsAction: async () => ({ values: {} }),
        read: async () => ({ kind: 'unavailable' }) as const,
        send: async () => ({ kind: 'unavailable' }) as const,
      }),
    ),
  );
};

describe('RoomLive', () => {
  test('the server render is the seeded room with the seeded identifiers', () => {
    const html = render(null);
    assert({
      given: 'a room view and its command identifiers from the server',
      should: 'render the room from them, with no freshness notice or refusal',
      actual: {
        topic: html.includes('Persisted debate topic'),
        seededIds: html.includes('value="seed-1"'),
        notice: /Reconnecting|no longer available|not acknowledged/.test(html),
      },
      expected: { topic: true, seededIds: true, notice: false },
    });
  });

  test('a refused native post shows its notice', () => {
    assert({
      given:
        'a room page returned to with the command-refused notice, without and with a known reason',
      should: 'say the command was not acknowledged, or why it was refused',
      actual: [
        render({ reason: null }).includes(
          'The command was not acknowledged. Review the current room and try again.',
        ),
        render({ reason: 'not-your-turn' }).includes(
          'It is the other side’s turn to strike.',
        ),
      ],
      expected: [true, true],
    });
  });
});
