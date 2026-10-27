import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  admissionRefusal,
  utcMonth,
  requireAdmissionTarget,
  requireBusyCap,
  requireOwnReservation,
  requireUnrefundedReservation,
  requireSponsor,
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
      requireSponsor(member, round(), host),
      requireSponsor(member, round({ status: 'active' }), host),
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
      actual: () => requireSponsor(account, candidate, host),
      code,
    });
});

test('a refunded reservation is never reused', async () => {
  assert({
    given: 'no reservation and a live one',
    should: 'return each as found',
    actual: [
      requireUnrefundedReservation(undefined),
      requireUnrefundedReservation(reservation())?.id,
    ],
    expected: [undefined, 'reservation'],
  });
  await assertRejects({
    given: 'a refunded reservation',
    should: 'refuse it',
    actual: () => requireUnrefundedReservation(reservation({ refundedAt: at })),
    code: 'CONFLICT',
  });
});

test('a model call counts only the reservation found for its Round', async () => {
  assert({
    given: 'the Round reservation, uncounted and already counted',
    should: 'return it either way: counting is idempotent at the call site',
    actual: [
      requireOwnReservation(reservation(), 'reservation').id,
      requireOwnReservation(reservation({ countedAt: at }), 'reservation').id,
    ],
    expected: ['reservation', 'reservation'],
  });
  for (const [label, current, id] of [
    ['no reservation', undefined, 'reservation'],
    ['another reservation', reservation(), 'other'],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the count',
      actual: () => requireOwnReservation(current, id),
      code: 'AUTHORIZATION',
    });
});

test('admission refuses eligibility, then the allowance, then capacity', async () => {
  assert({
    given: 'facts that trip each check in turn, and none',
    should: 'report the first refusal in order',
    actual: [
      admissionRefusal({ spent: 0, busy: 9 }, null, 4),
      admissionRefusal({ spent: 20, busy: 9 }, 20, 4),
      admissionRefusal({ spent: 19, busy: 4 }, 20, 4),
      admissionRefusal({ spent: 19, busy: 3 }, 20, 4),
    ],
    expected: ['not-eligible', 'allowance', 'capacity', null],
  });
  for (const busyCap of [0, -1, 1.5])
    await assertRejects({
      given: `a bot capacity of ${busyCap}`,
      should: 'refuse the configuration',
      actual: () => requireBusyCap(busyCap),
      code: 'VALIDATION',
    });
});

test('the allowance period is the exact UTC calendar month', () => {
  assert({
    given:
      'instants at a month start, the last millisecond of a year and mid-month',
    should: 'select the UTC calendar month holding each instant',
    actual: [
      '2026-10-01T00:00:00.000Z',
      '2026-12-31T23:59:59.999Z',
      '2026-02-14T09:30:00.000+05:00',
    ].map((instant) => {
      const { start, end } = utcMonth(new Date(instant));
      return [start.toISOString(), end.toISOString()];
    }),
    expected: [
      ['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
      ['2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
      ['2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'],
    ],
  });
});
