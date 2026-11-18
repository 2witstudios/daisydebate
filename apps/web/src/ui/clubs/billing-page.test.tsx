import { mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  billingView,
  noAction,
  plan,
  seatsView,
  words,
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
  renderToStaticMarkup(
    <ClubBillingPage
      view={view}
      seating={seating}
      action={noAction}
      now="2026-11-16T00:00:00.000Z"
      {...(notice ? { notice } : {})}
    />,
  );

test('an active plan shows its total, seats, next invoice, invoices and the portal', () => {
  const html = render();
  const text = words(html);
  assert({
    given: 'a 14-seat plan renewing on 1 Dec',
    should:
      'show the plan, the change-seats form, the invoices and portal posts',
    actual: [
      text.includes('$140 a month'),
      text.includes('14 × $10'),
      text.includes('8, with 2 invited'),
      text.includes('1 Dec 2026 · $140.00'),
      text.includes('Change seats'),
      text.includes('so the lowest without giving up a seat is 10'),
      text.includes('Seats added, prorated'),
      text.includes('$11.61'),
      html.includes(
        'action="/api/clubs/cccccccccccccccccccccccc/billing/portal"',
      ),
      text.includes('Cancel the club'),
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
  const html = render(
    { ...billingView, plan: cut },
    { ...seatsView, plan: cut },
  );
  assert({
    given: 'a plan whose seat count is under the seats in use',
    should:
      'list the holders and invitations to choose from, with the end-of-day consequence',
    actual: [
      words(html).includes('Choose 2 seats to give up'),
      html.includes('name="releaseSeat"'),
      html.includes('name="releaseInvitation"'),
      words(html).includes('drop to the free plan at the end of today (UTC)'),
    ],
    expected: [true, true, true, true],
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
  const html = renderToStaticMarkup(
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
      words(html).includes('Your seats are being confirmed.'),
      html.includes(
        'action="/api/clubs/cccccccccccccccccccccccc/billing/checkout"',
      ),
      words(html).includes('Change seats'),
    ],
    expected: [true, true, false],
  });
  assert({
    given: 'the purchase-pending notice',
    should: 'show its fixed sentence',
    actual: words(render(billingView, seatsView, 'purchase-pending')).includes(
      'Your purchase is being checked.',
    ),
    expected: true,
  });
});
