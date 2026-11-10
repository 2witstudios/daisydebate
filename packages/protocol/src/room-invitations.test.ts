import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  settledRoomInvitations,
  type PendingRoomInvitation,
} from './room-invitations';

setupRitewayBun();

const pending = (
  inviteeActorId: string,
  seat: 'debater' | 'judge',
): PendingRoomInvitation => ({
  id: `inv-${inviteeActorId}`,
  inviteeActorId,
  inviterActorId: 'host',
  seat,
  expiresAt: '2026-11-11T12:00:00.000Z',
});
const seat = (actorId: string, role: 'judge' | 'negative') => ({
  id: `p-${actorId}`,
  actorId,
  label: actorId,
  kind: 'human' as const,
  role,
  slot: 0,
  eligible: true,
  consentVersion: 0,
  consentCommandId: null,
});

test('settledRoomInvitations', () => {
  const invitations = [pending('jo', 'judge'), pending('bea', 'debater')];
  assert({
    given: 'the invited judge seated, the invited debater in the judge seat, then the Room started',
    should: 'accept only the seat of the invited kind, then expire every pending one',
    actual: [
      settledRoomInvitations(
        { status: 'assembling', participants: [seat('jo', 'judge')] },
        invitations,
      ),
      settledRoomInvitations(
        { status: 'assembling', participants: [seat('bea', 'judge')] },
        invitations,
      ),
      settledRoomInvitations(
        { status: 'started', participants: [seat('jo', 'judge')] },
        invitations,
      ).map((row) => row.state),
    ],
    expected: [
      [{ id: 'inv-jo', inviteeActorId: 'jo', state: 'accepted' }],
      [],
      ['expired', 'expired'],
    ],
  });
});
