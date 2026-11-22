import { assert, setupRitewayBun, test } from 'riteway/bun';
import { clubSeatBounds, clubInvitationMailRefusal } from './club-seats';

setupRitewayBun();

test('Club invitation mail shares exact quota boundaries and precedence', () => {
  const facts = { daily: 0, invitation: null };
  const checks = [
    clubInvitationMailRefusal({ ...facts, daily: 21 }, 2),
    clubInvitationMailRefusal({ ...facts, daily: 22 }, 2),
    clubInvitationMailRefusal(
      { daily: 0, invitation: { total: 4, recentOrOwed: 0 } },
      2,
    ),
    clubInvitationMailRefusal(
      {
        daily: 0,
        invitation: {
          total: clubSeatBounds.sendsPerInvitation,
          recentOrOwed: 1,
        },
      },
      2,
    ),
    clubInvitationMailRefusal(
      { daily: 0, invitation: { total: 1, recentOrOwed: 1 } },
      2,
    ),
    clubInvitationMailRefusal(
      { daily: 22, invitation: { total: 1, recentOrOwed: 1 } },
      2,
    ),
  ];
  assert({
    given:
      'new invitations and resends at the daily, lifetime and recent-or-owed boundaries',
    should:
      'share one rule with daily and lifetime caps before the recent-send refusal',
    actual: checks,
    expected: [
      null,
      'invitation-mail-limit',
      null,
      'invitation-mail-limit',
      'resend-too-soon',
      'invitation-mail-limit',
    ],
  });
});
