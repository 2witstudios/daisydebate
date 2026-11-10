import { assert, setupRitewayBun, test } from 'riteway/bun';
import { state } from './room-assembly.test-support';
import type { PendingRoomInvitation } from '@daisy/protocol';
import { decideInvitationEnd, decideRoomInvitation } from './room-invitations';

setupRitewayBun();

const now = '2026-11-10T12:00:00.000Z';
const later = '2026-11-11T12:00:00.000Z';
const base = state();
const room = {
  ...base,
  status: 'assembling' as const,
  participants: [],
  seatHolds: [],
  rules: { ...base.rules, seats: { ...base.rules.seats, judge: 1 } },
};
const host = room.hostActorId;
const jo = { actorId: 'jo', eligible: true, blocked: false };
const pendingFor = (
  inviteeActorId: string,
  seat: 'debater' | 'judge',
): PendingRoomInvitation => ({
  id: `inv-${inviteeActorId}`,
  inviteeActorId,
  inviterActorId: host,
  seat,
  expiresAt: later,
});
const decide = (
  overrides: Partial<Parameters<typeof decideRoomInvitation>[0]>,
) =>
  decideRoomInvitation({
    room,
    callerActorId: host,
    invitee: jo,
    seat: 'judge',
    pending: [],
    now,
    ...overrides,
  });

test('a host invites a member to judge', () => {
  assert({
    given: 'the host of an assembling Room and an eligible member',
    should: 'invite them to the judge seat for 24 hours',
    actual: decide({}),
    expected: {
      ok: true,
      kind: 'invite',
      inviteeActorId: 'jo',
      seat: 'judge',
      expiresAt: later,
    },
  });
});

test('who may not be invited', () => {
  const seated = {
    ...room,
    participants: [
      {
        id: 'p',
        actorId: 'jo',
        label: 'jo',
        kind: 'human' as const,
        role: 'negative' as const,
        slot: 0,
        eligible: true,
        consentVersion: 0,
        consentCommandId: null,
      },
    ],
  };
  assert({
    given: 'each case that must change nothing',
    should: 'refuse with its reason',
    actual: [
      decide({ callerActorId: 'someone' }),
      decide({ room: { ...room, status: 'closed' } }),
      decide({ invitee: null }),
      decide({ invitee: { ...jo, blocked: true } }),
      decide({ invitee: { ...jo, eligible: false } }),
      decide({ invitee: { ...jo, actorId: host } }),
      decide({ room: seated }),
      decide({ pending: [pendingFor('jo', 'debater')] }),
    ].map((decision) => (decision.ok ? 'ok' : decision.refusal)),
    expected: [
      'not-host',
      'room-not-assembling',
      'member-unknown',
      'member-unavailable',
      'member-unavailable',
      'member-unavailable',
      'already-seated',
      'already-invited',
    ],
  });
});

test('a repeat and a full seat', () => {
  const judgeHeld = {
    ...room,
    seatHolds: [{ actorId: 'ann', seat: 'judge' as const, until: later }],
  };
  assert({
    given:
      'the same invitation again, a judge seat another invite holds, then a member a challenge holds a seat for',
    should:
      'answer the repeat unchanged, refuse the second judge, and not invite over the challenge hold',
    actual: [
      decide({ pending: [pendingFor('jo', 'judge')] }),
      decide({ room: judgeHeld }),
      decide({
        room: {
          ...room,
          seatHolds: [
            { actorId: 'jo', seat: 'debater' as const, until: later },
          ],
        },
      }),
    ],
    expected: [
      { ok: true, kind: 'repeat', invitationId: 'inv-jo' },
      { ok: false, refusal: 'no-free-seat' },
      { ok: false, refusal: 'already-invited' },
    ],
  });
});

test('ending an invitation', () => {
  const invitation = pendingFor('jo', 'judge');
  const end = (callerActorId: string, kind: 'decline' | 'withdraw') =>
    decideInvitationEnd({
      invitation,
      hostActorId: host,
      callerActorId,
      end: kind,
      now,
    });
  assert({
    given: 'the invitee, the host and a stranger',
    should: 'let the invitee decline and the host withdraw, and nobody else',
    actual: [
      end('jo', 'decline'),
      end(host, 'withdraw'),
      end('someone', 'decline'),
      end('jo', 'withdraw'),
      decideInvitationEnd({
        invitation,
        hostActorId: host,
        callerActorId: 'jo',
        end: 'decline',
        now: later,
      }),
    ],
    expected: [
      { ok: true, state: 'declined' },
      { ok: true, state: 'withdrawn' },
      { ok: false, refusal: 'invitation-ended' },
      { ok: false, refusal: 'not-host' },
      { ok: false, refusal: 'invitation-ended' },
    ],
  });
});
