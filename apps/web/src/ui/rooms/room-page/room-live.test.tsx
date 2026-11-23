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
import type { RoomView } from '@daisy/protocol/room-contract';
import type { RoomNotice } from '../../../features/rooms/command-answer';
import { initialInvitationForm } from '../../../features/room-invitations/submit';
import {
  accessibleWithin,
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { RoomLive } from './room-live';

setupRitewayBun();

const render = (
  notice: RoomNotice | null,
  view: RoomView = assemblySnapshot,
  viewerLabel = 'Viewer',
) => {
  const ids = sequentialId('seed');
  return renderAccessible(
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

/** The whole rendered page, for questions about the document itself (ids, hidden fields). */
const pageOf = (view: AccessibleView) =>
  view.all('heading', undefined, { hidden: true })[0]!.ownerDocument.body;

/**
 * A closed dialog, found by its title: a closed dialog's aria-labelledby name
 * is not computed, so the title heading's id must be the dialog's label.
 */
const closedDialog = (view: AccessibleView, title: string) => {
  const heading = view.get('heading', title, { level: 2, hidden: true });
  const dialog = heading.closest('dialog');
  if (!dialog || dialog.getAttribute('aria-labelledby') !== heading.id)
    throw new Error(`No dialog labelled by its ${title} heading`);
  return dialog;
};

describe('RoomLive', () => {
  test('the server render is the seeded room with the seeded identifiers', () => {
    const view = render(null);
    assert({
      given: 'a room view and its command identifiers from the server',
      should: 'render the room from them, with no freshness notice or refusal',
      actual: {
        topic: view.textContent().includes('Persisted debate topic'),
        seededIds: pageOf(view).querySelector('input[value="seed-1"]') !== null,
        notice: /Reconnecting|no longer available|refused|may have been/.test(
          view.textContent(),
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
        render({ kind: 'refused', reason: null })
          .textContent()
          .includes(
            'The room refused that command. Review the current room and try again.',
          ),
        render({ kind: 'refused', reason: 'version-conflict' })
          .textContent()
          .includes('The room changed. Review the latest room and try again.'),
        render({ kind: 'unacknowledged' })
          .textContent()
          .includes(
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
    const hostView = render(null, invited, 'host');
    const dialog = closedDialog(hostView, 'Invite people');
    const inHeader = hostView
      .all('banner')
      .some((banner) => banner.contains(dialog));
    const inDialog = accessibleWithin(dialog);
    const pageText = hostView.textContent();
    const dialogText = inDialog.textContent();
    const hostFacts = {
      inHeader,
      form: inDialog.has('button', 'Send invitation', { hidden: true }),
      pending: dialogText.includes('@coach · invited to judge'),
      outsideDialog: hostView
        .all('button', 'Send invitation', { hidden: true })
        .some((button) => !dialog.contains(button)),
      invitedNotice: pageText.includes('You’re invited'),
    };
    const ids = [...pageOf(hostView).querySelectorAll('[id]')].map(
      (element) => element.id,
    );
    const invitee = render(
      null,
      {
        ...invited,
        capabilities: { ...invited.capabilities, host: false },
      },
      'coach',
    );
    assert({
      given: 'the host of a room with one pending invitation',
      should:
        'keep the invite form and the pending invitation inside the header dialog, with no invite card on the page',
      actual: hostFacts,
      expected: {
        inHeader: true,
        form: true,
        pending: true,
        outsideDialog: false,
        invitedNotice: false,
      },
    });
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
        // Dialog content is hidden while closed, so visible text is outside any dialog.
        notice: invitee
          .all('paragraph')
          .some((p) => p.textContent?.includes('@host invited you to judge.')),
        decline: invitee.has('button', 'Decline'),
        invitePeople: invitee.textContent().includes('Invite people'),
      },
      expected: { notice: true, decline: true, invitePeople: false },
    });
  });
});
