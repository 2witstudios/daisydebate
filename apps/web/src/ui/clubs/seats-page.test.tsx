import { mock } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { noAction, seatsView } from './club-view.test-support';

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
  renderAccessible(
    <ClubSeatsPage view={view} filter={filter} action={noAction} />,
  );

/** The value a form posts for one field. */
const posted = (form: Element, field: string) =>
  (
    (form as HTMLFormElement).elements.namedItem(
      field,
    ) as HTMLInputElement | null
  )?.value;

test('the seats board counts filled, invited and empty seats and filters by ladder', () => {
  const view = render();
  const text = view.textContent();
  const filters = view.within('navigation', 'Filter members');
  assert({
    given: '8 seats held and 2 invitations on a 14-seat plan',
    should: 'show the tally, the monthly total and every filter with its count',
    actual: [
      text.includes('8 of 14'),
      text.includes('2 invited · 4 empty'),
      text.includes('$140'),
      filters.names('link'),
      filters.attribute('link', 'Youth · 6', 'href'),
    ],
    expected: [
      true,
      true,
      true,
      ['Everyone · 11', 'Youth · 6', 'Open · 2', 'Invited · 2'],
      '/clubs/cccccccccccccccccccccccc/seats?show=youth',
    ],
  });
  assert({
    given: 'the Invited filter',
    should: 'list only the invitations, with resend and cancel',
    actual: [
      render('invited').textContent().includes('Sam Rivera'),
      render('invited').textContent().includes('rosa.j@lakeside.edu'),
      render('invited').has(
        'button',
        'Cancel the invite to rosa.j@lakeside.edu',
      ),
      render('invited').count('button', 'Resend'),
    ],
    expected: [false, true, true, 2],
  });
  assert({
    given: 'the Open filter',
    should: 'list only Open seat holders',
    actual: [
      render('open').textContent().includes('Leo Castillo'),
      render('open').textContent().includes('Theo Haddad'),
    ],
    expected: [true, false],
  });
});

test('empty seats get their band, and the invite form posts an email', () => {
  const full = render('everyone', {
    ...seatsView,
    plan: { ...seatsView.plan, seatCount: 10, monthlyTotalMinor: 10000 },
  });
  // Rendered last: a view reads labels through the one live document.
  const view = render();
  const invite = view.within('form', 'Invite to a seat');
  assert({
    given: 'a plan with 4 empty seats, and one with none',
    should: 'show the empty-seats band only when there are empty seats',
    actual: [
      view.textContent().includes('4 empty seats'),
      view.textContent().includes('You pay for 14.'),
      full.textContent().includes('empty seats'),
    ],
    expected: [true, true, false],
  });
  assert({
    given: 'the invite form',
    should: 'post an email as an invite command',
    actual: [
      posted(view.get('form', 'Invite to a seat'), 'kind'),
      invite.attribute('textbox', 'Email', 'type'),
      invite.has('button', 'Send invitation'),
    ],
    expected: ['invite', 'email', true],
  });
});

test('moving or removing a seat says Premium ends at the end of today (UTC)', () => {
  const view = render();
  const text = view.textContent();
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
      view.count('button', 'Remove seat'),
    ],
    expected: [true, true, true, true, true, 8],
  });
  assert({
    given: 'a member without a seat while seats are free',
    should: 'offer to give them a seat',
    actual: view.has('button', 'Give a seat'),
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
  const text = render('everyone', view).textContent();
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
