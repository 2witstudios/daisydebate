import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  settledRoomInvitations,
  type PendingRoomInvitation,
} from './room-invitations';

setupRitewayBun();

const pending = (
  inviteeActorId: string,
  seat: 'side' | 'judge',
): PendingRoomInvitation => ({
  id: `inv-${inviteeActorId}`,
  inviteeActorId,
  inviterActorId: 'host',
  seat,
  expiresAt: '2026-11-11T12:00:00.000Z',
});
const seat = (actorId: string, kind: 'judge' | 'side') => ({
  id: `p-${actorId}`,
  actorId,
  label: actorId,
  kind: 'human' as const,
  seat:
    kind === 'judge' ? { kind, slot: 0 } : { kind, side: 'negative', slot: 0 },
  teamOpen: false,
  positionOpen: false,
  eligible: true,
  consentVersion: 0,
  consentCommandId: null,
});

test('settledRoomInvitations', () => {
  const invitations = [pending('jo', 'judge'), pending('bea', 'side')];
  assert({
    given:
      'the invited judge seated, the invited debater in the judge seat, then the Room started',
    should:
      'accept the seat of the invited kind, end one whose invitee chose another, then expire every pending one',
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
      [{ id: 'inv-bea', inviteeActorId: 'bea', state: 'expired' }],
      ['expired', 'expired'],
    ],
  });
});
