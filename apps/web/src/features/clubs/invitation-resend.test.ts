import { assert, setupRitewayBun, test } from 'riteway/bun';
import { clubInvitationResendRefusal } from './invitation-resend';

setupRitewayBun();

test('Club resend preserves plan, existence and expiry refusal order', () => {
  const now = '2026-11-22T12:00:00.000Z';
  const invitation = {
    id: 'i'.repeat(24),
    email: 'invitee@example.test',
    createdAt: now,
    expiresAt: now,
  };
  assert({
    given:
      'inactive plans, missing invitations, exact expiry and a live invitation',
    should:
      'refuse in the existing order and permit only the live invitation to reach mail checks',
    actual: [
      clubInvitationResendRefusal({ active: false, invitation: null, now }),
      clubInvitationResendRefusal({ active: true, invitation: null, now }),
      clubInvitationResendRefusal({ active: true, invitation, now }),
      clubInvitationResendRefusal({
        active: true,
        invitation: { ...invitation, expiresAt: '2026-11-22T12:00:00.001Z' },
        now,
      }),
    ],
    expected: [
      'no-active-plan',
      'invitation-not-found',
      'invitation-expired',
      null,
    ],
  });
});
