import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sequentialId } from '@daisy/clock';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { roomCommandIds } from '../../../features/rooms/room-command-ids';
import { WithAppRouter } from '../../test-support/app-router';
import { RoomLive } from './room-live';

setupRitewayBun();

const render = (refused: boolean) => {
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
        refused,
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
    const html = render(false);
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
      given: 'a room page returned to with the command-refused notice',
      should: 'say the command was not acknowledged',
      actual: render(true).includes(
        'The command was not acknowledged. Review the current room and try again.',
      ),
      expected: true,
    });
  });
});
