import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomView } from '@daisy/protocol';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { initialInvitationForm } from '../../../features/room-invitations/submit';
import { InvitedNotice } from './invited-notice';

setupRitewayBun();

const invitation = {
  id: 'i'.repeat(24),
  seat: 'judge' as const,
  invitee: 'coach',
  inviter: 'host',
  expiresAt: '2026-11-11T12:00:00.000Z',
};
const render = (view: RoomView, viewerLabel: string) =>
  renderToStaticMarkup(
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

test('InvitedNotice', () => {
  const invited = render(guest, 'coach');
  assert({
    given: 'the invited member',
    should:
      'say they are invited, who invited them, that the judge seat is theirs, and offer Decline',
    actual: [
      invited.includes('>You’re invited</h2>'),
      invited.includes('@host invited you to judge.'),
      invited.includes('The judge seat below is held for you.'),
      invited.includes('name="intent" value="decline"'),
      invited.includes('>Decline</button>'),
      invited.includes('<dialog'),
    ],
    expected: [true, true, true, true, true, false],
  });
  assert({
    given: 'a member invited as a debater',
    should: 'say a debater seat is held',
    actual: render(
      { ...guest, invitations: [{ ...invitation, seat: 'debater' }] },
      'coach',
    ).includes('A debater seat below is held for you.'),
    expected: true,
  });
  assert({
    given:
      'the host who sent it, a member with no invitation, and the invited member once the Room started',
    should: 'show nothing',
    actual: [
      render({ ...assemblySnapshot, invitations: [invitation] }, 'host'),
      render(guest, 'someone'),
      render({ ...guest, status: 'started' }, 'coach'),
    ],
    expected: ['', '', ''],
  });
});
