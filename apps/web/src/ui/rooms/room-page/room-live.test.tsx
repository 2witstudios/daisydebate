import { renderToStaticMarkup } from 'react-dom/server';
import { idle } from '../../../features/forms/form-state';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sequentialId } from '@daisy/clock';
import {
  assemblySnapshot,
  pendingInvitation,
} from '../../../features/rooms/assembly.test-support';
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
  viewerLabel = 'Viewer',
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
        viewerLabel,
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
        chat: null,
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

  test('Invite people is the host’s header dialog, and an invitation is the invitee’s inline notice', () => {
    const invited: RoomView = {
      ...assemblySnapshot,
      invitations: [pendingInvitation],
    };
    const host = render(null, invited, 'host');
    const invitee = render(
      null,
      {
        ...invited,
        capabilities: { ...invited.capabilities, host: false },
      },
      'coach',
    );
    const inviteDialog = (html: string) =>
      html.match(
        /<dialog[^>]*aria-labelledby="invite-people-title".*?<\/dialog>/s,
      )?.[0] ?? '';
    assert({
      given: 'the host of a room with one pending invitation',
      should:
        'keep the invite form and the pending invitation inside the header dialog, with no invite card on the page',
      actual: {
        inHeader:
          /<header.*aria-labelledby="invite-people-title".*<\/header>/s.test(
            host,
          ),
        form: inviteDialog(host).includes('Send invitation'),
        pending: inviteDialog(host).includes('@coach · invited to judge'),
        outsideDialog: host
          .replace(inviteDialog(host), '')
          .includes('Send invitation'),
        invitedNotice: host.includes('You’re invited'),
      },
      expected: {
        inHeader: true,
        form: true,
        pending: true,
        outsideDialog: false,
        invitedNotice: false,
      },
    });
    const ids = [...host.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert({
      given: 'the host’s page, with Room setup and both header dialogs in it',
      should: 'give no two elements the same id',
      actual: ids.filter((id, index) => ids.indexOf(id) !== index),
      expected: [],
    });
    assert({
      given: 'the invited member',
      should:
        'show who invited them and Decline on the page, outside any dialog, and no Invite people',
      actual: {
        notice: invitee
          .replace(/<dialog.*?<\/dialog>/gs, '')
          .includes('@host invited you to judge.'),
        decline: invitee.includes('>Decline</button>'),
        invitePeople: invitee.includes('Invite people'),
      },
      expected: { notice: true, decline: true, invitePeople: false },
    });
  });
});
