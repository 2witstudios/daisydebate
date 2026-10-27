import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sequentialId } from '@daisy/clock';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { roomCommandIds } from '../../../features/rooms/room-command-ids';
import { WithAppRouter } from '../../test-support/app-router';
import type { RoomRefusal, RoomView } from '@daisy/protocol';
import { RoomLive } from './room-live';

setupRitewayBun();

const render = (
  refusal: { readonly reason: RoomRefusal | null } | null,
  view: RoomView = assemblySnapshot,
) => {
  const ids = sequentialId('seed');
  return renderToStaticMarkup(
    h(
      WithAppRouter,
      null,
      h(RoomLive, {
        view,
        ids: roomCommandIds(view, () => ids.next()),
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
          'You can’t strike on this turn.',
        ),
      ],
      expected: [true, true],
    });
  });

  test('the server render of a strike shows the turn’s real time left (PR #472 review)', () => {
    const striking: RoomView = {
      ...assemblySnapshot,
      topic: null,
      resolutionDraw: {
        visibility: 'progress',
        drawSize: 3,
        strikes: [],
        turn: {
          ordinal: 0,
          side: 'negative',
          dueAt: '2026-10-12T00:01:00.000Z',
          remainingMs: 60_000,
        },
        revealedAt: null,
      },
    };
    const html = render(null, striking);
    const timer = /role="timer"[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? '';
    assert({
      given:
        'a striking Room seeded with no client clock yet, as without scripts',
      should: 'count down from the server read: one minute, not epoch-sized',
      actual: [timer.includes('1:00'), /\d{4,}:\d{2}/.test(timer)],
      expected: [true, false],
    });
  });
});
