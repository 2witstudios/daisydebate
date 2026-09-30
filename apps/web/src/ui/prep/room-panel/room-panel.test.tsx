import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomPanelView } from '../../../features/prep/room-panel';
import { parseRoomPanelQuery } from '../../../features/prep/room-panel-query';
import { RoomPanel } from './room-panel';

setupRitewayBun();

describe('RoomPanel', () => {
  test('the panel carries its offline banner slot and never a mutation', () => {
    const html = renderToString(
      h(RoomPanel, {
        view: roomPanelView(
          parseRoomPanelQuery({ pin: 'aff-rights' }),
          160,
          '2026-09-30T12:04:00.000Z',
        ),
        loadedAt: '12:04',
      }),
    );
    assert({
      given: 'a pinned panel while online',
      should:
        'render no offline banner and no enabled button other than the picker',
      actual: [
        html.includes('Prep cannot reach the server'),
        html.match(/<button /g)?.length ?? 0,
      ],
      expected: [false, 0],
    });
  });
});
