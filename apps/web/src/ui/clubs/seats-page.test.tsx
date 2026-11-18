import { mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noAction, seatsView, words } from './club-view.test-support';

setupRitewayBun();
const navigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...navigation,
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}));
const { ClubSeatsPage } = await import('./seats-page');

const render = (
  filter: 'everyone' | 'youth' | 'open' | 'invited' = 'everyone',
  view = seatsView,
) =>
  renderToStaticMarkup(
    <ClubSeatsPage view={view} filter={filter} action={noAction} />,
  );

test('the seats board counts filled, invited and empty seats and filters by ladder', () => {
  const html = render();
  const text = words(html);
  assert({
    given: '8 seats held and 2 invitations on a 14-seat plan',
    should: 'show the tally, the monthly total and every filter with its count',
    actual: [
      text.includes('8 of 14'),
      text.includes('2 invited · 4 empty'),
      text.includes('$140'),
      text.includes('Everyone · 11'),
      text.includes('Youth · 6'),
      text.includes('Open · 2'),
      text.includes('Invited · 2'),
      html.includes('href="/clubs/cccccccccccccccccccccccc/seats?show=youth"'),
    ],
    expected: [true, true, true, true, true, true, true, true],
  });
  assert({
    given: 'the Invited filter',
    should: 'list only the invitations, with resend and cancel',
    actual: [
      words(render('invited')).includes('Sam Rivera'),
      words(render('invited')).includes('rosa.j@lakeside.edu'),
      render('invited').includes(
        'aria-label="Cancel the invite to rosa.j@lakeside.edu"',
      ),
      words(render('invited')).includes('Resend'),
    ],
    expected: [false, true, true, true],
  });
  assert({
    given: 'the Open filter',
    should: 'list only Open seat holders',
    actual: [
      words(render('open')).includes('Leo Castillo'),
      words(render('open')).includes('Theo Haddad'),
    ],
    expected: [true, false],
  });
});

test('empty seats get their band, and the invite form posts an email', () => {
  const html = render();
  const full = render('everyone', {
    ...seatsView,
    plan: { ...seatsView.plan, seatCount: 10, monthlyTotalMinor: 10000 },
  });
  assert({
    given: 'a plan with 4 empty seats, and one with none',
    should: 'show the empty-seats band only when there are empty seats',
    actual: [
      words(html).includes('4 empty seats'),
      words(html).includes('You pay for 14.'),
      words(full).includes('empty seats'),
    ],
    expected: [true, true, false],
  });
  assert({
    given: 'the invite form',
    should: 'post an email as an invite command',
    actual: [
      html.includes('name="kind" value="invite"'),
      html.includes('type="email"'),
      words(html).includes('Send invitation'),
    ],
    expected: [true, true, true],
  });
});

test('moving or removing a seat says Premium ends at the end of today (UTC)', () => {
  const text = words(render());
  assert({
    given: 'a seat holder’s Move and Remove controls',
    should:
      'offer members without a seat or someone new, and name the end-of-day consequence',
    actual: [
      text.includes('Move Theo Haddad’s seat to'),
      text.includes('Nia Okafor'),
      text.includes('Someone new: invite by email'),
      text.includes(
        'Theo Haddad stays a member and keeps their ratings and Rounds, and drops to the free plan at the end of today (UTC).',
      ),
      text.includes('No charge for moving a seat.'),
      text.includes('Remove seat'),
    ],
    expected: [true, true, true, true, true, true],
  });
  assert({
    given: 'a member without a seat while seats are free',
    should: 'offer to give them a seat',
    actual: text.includes('Give a seat'),
    expected: true,
  });
});

test('a seat the paid count no longer covers says so; an unpaid plan points to Billing', () => {
  const view = {
    ...seatsView,
    plan: { ...seatsView.plan, state: 'none' as const },
    seats: seatsView.seats.map((seat, index) =>
      index === 0 ? { ...seat, funded: false } : seat,
    ),
  };
  const text = words(render('everyone', view));
  assert({
    given: 'an unfunded seat on an unpaid plan',
    should: 'mark the seat and send the manager to Billing',
    actual: [
      text.includes('Not covered by the seat count'),
      text.includes('Seats start once the club plan is paid.'),
    ],
    expected: [true, true],
  });
});
