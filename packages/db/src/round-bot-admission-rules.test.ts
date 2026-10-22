import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  admissionRefusal,
  requireAdmissionTarget,
  requireBusyCap,
  requireReservationProvenance,
  requireSponsor,
  reservationMutation,
} from './round-bot-admission-rules';

setupRitewayBun();

const host = 'hostaaaaa1b2c3d4e5f6g7h8';
const member = { member: true, erased: false };
const round = (overrides: Record<string, unknown> = {}) => ({
  createdByActorId: host,
  competitionType: 'casual',
  status: 'scheduled',
  ...overrides,
});
const at = new Date('2026-10-22T12:00:00.000Z');
const reservation = (overrides: Record<string, unknown> = {}) => ({
  id: 'reservation',
  reservedAt: at,
  countedAt: null,
  refundedAt: null,
  ...overrides,
});

test('admission targets are cuid2 actor and Round ids', async () => {
  assert({
    given: 'cuid2 ids',
    should: 'admit the target',
    actual: requireAdmissionTarget({ actorId: host, roundId: host }),
    expected: undefined,
  });
  await assertRejects({
    given: 'a non-cuid2 Round id',
    should: 'refuse it as invalid input',
    actual: () => requireAdmissionTarget({ actorId: host, roundId: '1' }),
    code: 'VALIDATION',
  });
});

test('only the host of an unranked unfinished Round sponsors a bot', async () => {
  assert({
    given: 'a member host of scheduled and active casual Rounds',
    should: 'admit the sponsor',
    actual: [
      requireSponsor(member, round(), host, 'admission'),
      requireSponsor(member, round({ status: 'active' }), host, 'admission'),
    ],
    expected: [undefined, undefined],
  });
  for (const [label, account, candidate, code] of [
    ['a missing Round', member, undefined, 'AUTHORIZATION'],
    [
      'another host',
      member,
      round({ createdByActorId: 'other' }),
      'AUTHORIZATION',
    ],
    ['no account', null, round(), 'AUTHORIZATION'],
    [
      'a non-member',
      { member: false, erased: false },
      round(),
      'AUTHORIZATION',
    ],
    [
      'an erased account',
      { member: true, erased: true },
      round(),
      'AUTHORIZATION',
    ],
    [
      'a ranked Round',
      member,
      round({ competitionType: 'ranked' }),
      'AUTHORIZATION',
    ],
    ['a completed Round', member, round({ status: 'completed' }), 'CONFLICT'],
  ] as const)
    await assertRejects({
      given: `admission with ${label}`,
      should: 'refuse the sponsor',
      actual: () => requireSponsor(account, candidate, host, 'admission'),
      code,
    });
});

test('settlement needs only the host, after the account or Round ended', async () => {
  assert({
    given: 'an erased host of a completed ranked Round',
    should: 'still admit settlement of their own reservation',
    actual: requireSponsor(
      { member: false, erased: true },
      round({ status: 'completed', competitionType: 'ranked' }),
      host,
      'settlement',
    ),
    expected: undefined,
  });
  await assertRejects({
    given: 'settlement by someone other than the host',
    should: 'refuse it',
    actual: () =>
      requireSponsor(
        member,
        round({ createdByActorId: 'other' }),
        host,
        'settlement',
      ),
    code: 'AUTHORIZATION',
  });
});

test('reservations without admission time or already refunded are not reused', async () => {
  assert({
    given: 'no reservation, a live one and a refunded one during refund',
    should: 'return each as found',
    actual: [
      requireReservationProvenance(undefined, false),
      requireReservationProvenance(reservation(), false)?.id,
      requireReservationProvenance(reservation({ refundedAt: at }), true)?.id,
    ],
    expected: [undefined, 'reservation', 'reservation'],
  });
  for (const row of [
    reservation({ reservedAt: null }),
    reservation({ refundedAt: at }),
  ])
    await assertRejects({
      given: `a reservation ${JSON.stringify(row)} outside a refund`,
      should: 'refuse it',
      actual: () => requireReservationProvenance(row, false),
      code: 'CONFLICT',
    });
});

test('counting is idempotent and a counted reservation refunds once', async () => {
  assert({
    given: 'counting, refunding a counted one, and refunding again',
    should: 'count, refund, then do nothing',
    actual: [
      reservationMutation(reservation(), 'reservation', false),
      reservationMutation(reservation({ countedAt: at }), 'reservation', false),
      reservationMutation(reservation({ countedAt: at }), 'reservation', true),
      reservationMutation(
        reservation({ countedAt: at, refundedAt: at }),
        'reservation',
        true,
      ),
    ],
    expected: ['count', 'count', 'refund', 'none'],
  });
  for (const [label, current, id] of [
    ['no reservation', undefined, 'reservation'],
    ['another reservation', reservation(), 'other'],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the mutation',
      actual: () => reservationMutation(current, id, false),
      code: 'AUTHORIZATION',
    });
  await assertRejects({
    given: 'a refund before any model call was counted',
    should: 'refuse it as a conflict',
    actual: () => reservationMutation(reservation(), 'reservation', true),
    code: 'CONFLICT',
  });
});

test('admission refuses provenance, then allowance, then capacity', async () => {
  assert({
    given: 'facts that trip each check in turn, and none',
    should: 'report the first refusal in order',
    actual: [
      admissionRefusal({ unknown: 1, spent: 5, busy: 9 }, 5, 4),
      admissionRefusal({ unknown: 0, spent: 5, busy: 9 }, 5, 4),
      admissionRefusal({ unknown: 0, spent: 4, busy: 4 }, 5, 4),
      admissionRefusal({ unknown: 0, spent: 4, busy: 3 }, 5, 4),
    ],
    expected: ['provenance', 'allowance', 'capacity', null],
  });
  for (const busyCap of [0, -1, 1.5])
    await assertRejects({
      given: `a bot capacity of ${busyCap}`,
      should: 'refuse the configuration',
      actual: () => requireBusyCap(busyCap),
      code: 'VALIDATION',
    });
});
