import { renderToStaticMarkup } from 'react-dom/server';
import { idle } from '../../../features/forms/form-state';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sequentialId } from '@daisy/clock';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { roomCommandIds } from '../../../features/rooms/room-command-ids';
import { WithAppRouter } from '../../test-support/app-router';
import type { RoomView } from '@daisy/protocol';
import type { RoomNotice } from '../../../features/rooms/command-answer';
import { initialInvitationForm } from '../../../features/room-invitations/submit';
import { RoomLive } from './room-live';

setupRitewayBun();

const render = (
  notice: RoomNotice | null,
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
        notice,
        commandAction: async () => idle(),
        waiverAction: async () => idle(),
        detailsAction: async () => idle(),
        settingsAction: async () => idle(),
        read: async () => ({ kind: 'unavailable' }) as const,
        send: async () => ({ kind: 'unavailable' }) as const,
        invitationAction: async () => initialInvitationForm,
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
        notice: /Reconnecting|no longer available|refused|may have been/.test(
          html,
        ),
      },
      expected: { topic: true, seededIds: true, notice: false },
    });
  });

  test('a native post that was not accepted shows its notice', () => {
    assert({
      given:
        'a room page returned to with the command-refused notice, without and with a known reason, and with the notice of a lost answer',
      should:
        'say the command was refused, or why, or that it may have been recorded',
      actual: [
        render({ kind: 'refused', reason: null }).includes(
          'The room refused that command. Review the current room and try again.',
        ),
        render({ kind: 'refused', reason: 'version-conflict' }).includes(
          'The room changed. Review the latest room and try again.',
        ),
        render({ kind: 'unacknowledged' }).includes(
          'That command may have been recorded. Review the room before trying again.',
        ),
      ],
      expected: [true, true, true],
    });
  });
});
