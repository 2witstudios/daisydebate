import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomView } from '@daisy/protocol';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { RoomInvitations } from './room-invitations';

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
    h(RoomInvitations, { view, viewerLabel, action: async () => ({}) }),
  );
const guest: RoomView = {
  ...assemblySnapshot,
  capabilities: { ...assemblySnapshot.capabilities, host: false },
};

test('RoomInvitations', () => {
  const host = render({ ...assemblySnapshot, invitations: [invitation] }, 'host');
  const invited = render({ ...guest, invitations: [invitation] }, 'coach');
  assert({
    given: 'the host with one pending judge invitation',
    should: 'offer the invite form and list it with Withdraw',
    actual: [
      host.includes('Send invitation'),
      host.includes('@coach · invited to judge'),
      host.includes('Withdraw'),
    ],
    expected: [true, true, true],
  });
  assert({
    given: 'the invited member',
    should: 'say who invited them, that the judge seat is theirs, and offer Decline',
    actual: [
      invited.includes('@host invited you to judge.'),
      invited.includes('The judge seat below is held for you.'),
      invited.includes('Decline'),
      invited.includes('Send invitation'),
    ],
    expected: [true, true, true, false],
  });
  assert({
    given: 'a member with no invitation, and a Room that started',
    should: 'show nothing',
    actual: [
      render({ ...guest, invitations: [] }, 'someone'),
      render(
        { ...assemblySnapshot, status: 'started', invitations: [invitation] },
        'host',
      ),
    ],
    expected: ['', ''],
  });
});
