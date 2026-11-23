import { mock } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import {
  billingView,
  noAction,
  plan,
  seatsView,
} from './club-view.test-support';

setupRitewayBun();
const navigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...navigation,
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}));
const { ClubBillingPage } = await import('./billing-page');
const { seatChangeSummary } = await import('./change-seats-form');

const render = (
  view = billingView,
  seating = seatsView,
  notice?: 'purchase-pending',
) =>
  renderAccessible(
    <ClubBillingPage
      view={view}
      seating={seating}
      action={noAction}
      now="2026-11-16T00:00:00.000Z"
      {...(notice ? { notice } : {})}
    />,
  );

test('an active plan shows its total, seats, next invoice, invoices and the portal', () => {
  const view = render();
  const text = view.textContent();
  const posts = (button: string) =>
    view.get('button', button).closest('form')?.getAttribute('action');
  assert({
    given: 'a 14-seat plan renewing on 1 Dec',
    should:
      'show the plan, the change-seats form, the invoices and portal posts',
    actual: [
      text.includes('$140 a month'),
      text.includes('14 × $10'),
      text.includes('8, with 2 invited'),
      text.includes('1 Dec 2026 · $140.00'),
      view.has('form', 'Change seats'),
      text.includes('so the lowest without giving up a seat is 10'),
      text.includes('Seats added, prorated'),
      text.includes('$11.61'),
      [
        posts('Manage payment'),
        posts('Download invoices'),
        posts('Cancel the club'),
      ].every(
        (action) =>
          action === '/api/clubs/cccccccccccccccccccccccc/billing/portal',
      ),
      view.has('heading', 'Cancel the club', { level: 2 }),
      text.includes('Seats stay Premium until 1 Dec 2026'),
      text.includes('4242'),
    ],
    expected: [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ],
  });
});

test('a seat increase estimates the proration now; a decrease says no credit', () => {
  const now = '2026-11-16T00:00:00.000Z';
  assert({
    given: 'two more seats halfway through a 30-day period, and two fewer',
    should: 'estimate about $10.00 now and the next invoice, or no credit',
    actual: [
      seatChangeSummary({ plan, target: 16, now }),
      seatChangeSummary({ plan, target: 12, now }),
    ],
    expected: [
      'From today: 16 seats, $160 a month. You pay about $10.00 now for the 2 new seats for the rest of this period. Your 1 Dec 2026 invoice is $160.00.',
      'From today: 12 seats, $120 a month. Fewer seats take effect now, with no credit for the rest of this month.',
    ],
  });
});

test('below the seats in use the form asks exactly who gives up a seat', () => {
  // A plan cut to 8 outside Daisy while 10 seats are in use.
  const cut = { ...plan, seatCount: 8, monthlyTotalMinor: 8000 };
  const view = render(
    { ...billingView, plan: cut },
    { ...seatsView, plan: cut },
  );
  const giveUp = view.within('group', 'Choose 2 seats to give up');
  assert({
    given: 'a plan whose seat count is under the seats in use',
    should:
      'list the holders and invitations to choose from, with the end-of-day consequence',
    actual: [
      giveUp.count('checkbox'),
      giveUp.attribute('checkbox', 'Sam Rivera', 'name'),
      giveUp.attribute('checkbox', 'rosa.j@lakeside.edu (invited)', 'name'),
      giveUp
        .textContent()
        .includes('drop to the free plan at the end of today (UTC)'),
    ],
    expected: [10, 'releaseSeat', 'releaseInvitation', true],
  });
});

test('before a first payment the club goes to Checkout; a return says seats are being confirmed', () => {
  const none = {
    ...plan,
    state: 'none' as const,
    seatCount: 0,
    monthlyTotalMinor: 0,
    renewsAt: null,
  };
  const view = renderAccessible(
    <ClubBillingPage
      view={{
        ...billingView,
        plan: none,
        invoices: [],
        portalAvailable: false,
      }}
      seating={{ ...seatsView, plan: none, seats: [], invitations: [] }}
      returned
      action={noAction}
      now="2026-11-16T00:00:00.000Z"
    />,
  );
  assert({
    given: 'an unpaid club returning from Checkout',
    should:
      'say the seats are being confirmed and offer Checkout, not a seat change',
    actual: [
      view.text('status').includes('Your seats are being confirmed.'),
      view
        .get('button', 'Continue to checkout')
        .closest('form')
        ?.getAttribute('action'),
      view.textContent().includes('Change seats'),
    ],
    expected: [
      true,
      '/api/clubs/cccccccccccccccccccccccc/billing/checkout',
      false,
    ],
  });
  assert({
    given: 'the purchase-pending notice',
    should: 'show its fixed sentence',
    actual: render(billingView, seatsView, 'purchase-pending')
      .text('status')
      .includes('Your purchase is being checked.'),
    expected: true,
  });
});
