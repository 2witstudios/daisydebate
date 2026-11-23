import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomView } from '@daisy/protocol/room-contract';
import {
  assemblySnapshot,
  pendingInvitation,
} from '../../../features/rooms/assembly.test-support';
import { initialInvitationForm } from '../../../features/room-invitations/submit';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { InvitedNotice } from './invited-notice';

setupRitewayBun();

const invitation = pendingInvitation;
const render = (view: RoomView, viewerLabel: string) =>
  renderAccessible(
    h(InvitedNotice, {
      view,
      viewerLabel,
      action: async () => initialInvitationForm,
    }),
  );
const guest: RoomView = {
  ...assemblySnapshot,
  capabilities: { ...assemblySnapshot.capabilities, host: false },
  invitations: [invitation],
};
/** The hidden fields a submit button posts with its form. */
const posted = (button: Element) =>
  Object.fromEntries(
    [
      ...((button as HTMLButtonElement).form?.querySelectorAll(
        'input[type="hidden"]',
      ) ?? []),
    ].map((input) => [
      (input as HTMLInputElement).name,
      (input as HTMLInputElement).value,
    ]),
  );

test('InvitedNotice', () => {
  const invited = render(guest, 'coach');
  const notice = invited.within('region', 'You’re invited');
  assert({
    given: 'the invited member',
    should:
      'say they are invited, who invited them, that the judge seat is theirs, and offer Decline',
    actual: [
      notice.has('heading', 'You’re invited', { level: 2 }),
      notice.textContent().includes('@host invited you to judge.'),
      notice.textContent().includes('The judge seat below is held for you.'),
      posted(notice.get('button', 'Decline')),
      invited.count('dialog', undefined, { hidden: true }),
    ],
    expected: [
      true,
      true,
      true,
      { intent: 'decline', invitationId: invitation.id },
      0,
    ],
  });
  assert({
    given: 'a member invited as a debater',
    should: 'say a debater seat is held',
    actual: render(
      { ...guest, invitations: [{ ...invitation, seat: 'side' }] },
      'coach',
    )
      .textContent()
      .includes('A debater seat below is held for you.'),
    expected: true,
  });
  assert({
    given:
      'the host who sent it, a member with no invitation, and the invited member once the Room started',
    should: 'show nothing',
    actual: [
      render(
        { ...assemblySnapshot, invitations: [invitation] },
        'host',
      ).textContent(),
      render(guest, 'someone').textContent(),
      render({ ...guest, status: 'started' }, 'coach').textContent(),
    ],
    expected: ['', '', ''],
  });
});
