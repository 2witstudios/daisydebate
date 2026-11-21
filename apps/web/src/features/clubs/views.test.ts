import { addMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ClubSeatingRead } from '@daisy/db';
import {
  clubBillingView,
  clubSeatsView,
  prorationEstimateMinor,
} from './views';
import { clubIdFrom, invitationFrom } from './routes';

setupRitewayBun();
const id = (c: string) => c.repeat(24);
const now = '2026-11-18T12:00:00.000Z';
const period = {
  subscriptionId: id('s'),
  startsAt: '2026-11-03T00:00:00.000Z',
  endsAt: '2026-12-03T00:00:00.000Z',
};
const person = (c: string, ageBand: 'minor' | 'adult' | null) => ({
  userId: id(c),
  name: `Person ${c}`,
  username: `p-${c}`,
  ageBand,
});
const read = (
  over: Partial<ClubSeatingRead['plan']> = {},
): ClubSeatingRead => ({
  club: {
    id: id('c'),
    kind: 'school',
    name: 'Northside Debate',
    handle: 'northside',
    ownerUserId: id('o'),
  },
  now,
  plan: {
    evidence: {
      lifecycle: 'active',
      settlement: { kind: 'paid', invoiceId: 'in_1', period },
    },
    seatCount: 2,
    renewalOff: false,
    amountMinor: 1000,
    hasCustomer: true,
    vendorSubscriptionId: 'sub_1',
    ...over,
  },
  seats: [
    {
      userId: id('a'),
      assignedAt: '2026-11-04T00:00:00.000Z',
      person: person('a', 'minor'),
    },
    {
      userId: id('b'),
      assignedAt: '2026-11-05T00:00:00.000Z',
      person: person('b', 'adult'),
    },
    {
      userId: id('d'),
      assignedAt: '2026-11-06T00:00:00.000Z',
      person: person('d', null),
    },
  ],
  invitations: [
    {
      id: id('i'),
      email: 'live@club.example',
      createdAt: now,
      expiresAt: '2026-12-02T12:00:00.000Z',
    },
    {
      id: id('j'),
      email: 'old@club.example',
      createdAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2026-10-15T00:00:00.000Z',
    },
  ],
  members: [person('m', 'adult')],
});

test('the seats board names the ladder, the unfunded seat and the lapsed invitation', () => {
  const view = clubSeatsView(read());
  assert({
    given: 'three seats on a 2-seat plan, one live and one lapsed invitation',
    should:
      'fund the two earliest seats, count the live invitation as used, and mark the lapsed one',
    actual: [
      view.seats.map((seat) => [seat.ladder, seat.funded]),
      view.invitations.map((invitation) => invitation.expired),
      [
        view.plan.state,
        view.plan.seatsUsed,
        view.plan.lowestSeatCount,
        view.plan.monthlyTotalMinor,
      ],
    ],
    expected: [
      [
        ['youth', true],
        ['open', true],
        [null, false],
      ],
      [false, true],
      ['active', 4, 4, 2000],
    ],
  });
});

test('the plan state follows the verified evidence', () => {
  const state = (over: Partial<ClubSeatingRead['plan']>) =>
    clubSeatsView(read(over)).plan.state;
  assert({
    given:
      'no plan, a renewal turned off, a failed renewal in grace, and a cancelled plan',
    should: 'read none, cancelled, payment-due and ended',
    actual: [
      state({ evidence: null, seatCount: 0 }),
      state({ renewalOff: true }),
      state({
        evidence: {
          lifecycle: 'past_due',
          settlement: {
            kind: 'renewal_failed',
            invoiceId: 'in_2',
            period: {
              ...period,
              startsAt: '2026-11-15T00:00:00.000Z',
              endsAt: '2026-12-15T00:00:00.000Z',
            },
            previous: {
              invoiceId: 'in_1',
              period: {
                ...period,
                startsAt: '2026-10-15T00:00:00.000Z',
                endsAt: '2026-11-15T00:00:00.000Z',
              },
            },
          },
        },
      }),
      state({
        evidence: {
          lifecycle: 'canceled',
          settlement: { kind: 'paid', invoiceId: 'in_1', period },
        },
      }),
    ],
    expected: ['none', 'cancelled', 'payment-due', 'ended'],
  });
});

test('billing offers the portal only with a customer and purchases only when released', () => {
  const view = (released: boolean, hasCustomer: boolean) =>
    clubBillingView(read({ hasCustomer }), {
      invoices: [],
      configured: true,
      released,
    });
  assert({
    given: 'released with a customer, and unreleased without one',
    should: 'offer both, then neither',
    actual: [view(true, true), view(false, false)].map((v) => [
      v.portalAvailable,
      v.purchaseAvailable,
    ]),
    expected: [
      [true, true],
      [false, false],
    ],
  });
});

test('a seat increase is estimated for the rest of the paid period', () => {
  assert({
    given: '3 seats added halfway through a 30-day period at $10',
    should: 'estimate $15.00, and nothing for no seats or a past period',
    actual: [
      prorationEstimateMinor({
        addedSeats: 3,
        seatPriceMinor: 1000,
        periodStartsAt: '2026-11-03T00:00:00.000Z',
        periodEndsAt: '2026-12-03T00:00:00.000Z',
        now: '2026-11-18T00:00:00.000Z',
      }),
      prorationEstimateMinor({
        addedSeats: 0,
        seatPriceMinor: 1000,
        periodStartsAt: period.startsAt,
        periodEndsAt: period.endsAt,
        now,
      }),
      prorationEstimateMinor({
        addedSeats: 3,
        seatPriceMinor: 1000,
        periodStartsAt: period.startsAt,
        periodEndsAt: period.endsAt,
        now: '2027-01-01T00:00:00.000Z',
      }),
    ],
    expected: [1500, 0, 0],
  });
});

test('the club and invitation come from the path, never the body', () => {
  const at = (path: string) => new Request(`https://daisy.example${path}`);
  const attempt = (run: () => unknown) => {
    try {
      return run();
    } catch {
      return 'not found';
    }
  };
  assert({
    given: 'club and invitation paths, and malformed ones',
    should: 'read the ids, and refuse the rest',
    actual: [
      clubIdFrom(at(`/api/clubs/${id('c')}/seats`)),
      invitationFrom(at(`/api/clubs/invitations/${id('c')}.${id('i')}`)),
      attempt(() => clubIdFrom(at('/api/clubs/new/seats'))),
      attempt(() => invitationFrom(at(`/api/clubs/invitations/${id('c')}`))),
    ],
    expected: [
      id('c'),
      { organizationId: id('c'), invitationId: id('i') },
      'not found',
      'not found',
    ],
  });
});

test('a plan awaiting its first verified payment is starting, not ended', () => {
  assert({
    given: 'Checkout completed and the first invoice not yet verified paid',
    should: 'read none (seats being confirmed), not ended',
    actual: clubSeatsView(
      read({
        evidence: { lifecycle: 'incomplete', settlement: { kind: 'unpaid' } },
      }),
    ).plan.state,
    expected: 'none',
  });
});

test('the board lists live invitations and only the latest lapsed ones', () => {
  const lapsed = Array.from({ length: 300 }, (_, n) => ({
    id: `${n}`.padStart(24, 'l'),
    email: `l${n}@club.example`,
    createdAt: '2026-10-01T00:00:00.000Z',
    expiresAt: addMs('2026-10-15T00:00:00.000Z', n * 60_000),
  }));
  const base = read();
  const view = clubSeatsView({
    ...base,
    invitations: [...base.invitations, ...lapsed],
  });
  assert({
    given: 'one live invitation and 301 lapsed ones',
    should:
      'list the live one and the 50 latest lapsed, so the page always renders',
    actual: [
      view.invitations.filter((i) => !i.expired).length,
      view.invitations.filter((i) => i.expired).length,
      view.invitations.find((i) => i.expired)?.email,
    ],
    expected: [1, 50, 'l299@club.example'],
  });
});
