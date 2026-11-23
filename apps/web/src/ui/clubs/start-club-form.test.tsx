import { mock } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { noAction } from './club-view.test-support';

setupRitewayBun();
const navigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...navigation,
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}));
const { StartClubForm } = await import('./start-club-form');

test('starting a club asks its name, kind and seats, and prices the plan', () => {
  const view = renderAccessible(<StartClubForm action={noAction} />);
  const text = view.textContent();
  const kinds = view.within('group', 'What kind of club?');
  assert({
    given: 'the Start a club form',
    should: 'offer the three kinds, the seat count and Checkout at $10 a seat',
    actual: [
      view.attribute('textbox', 'Club name', 'name'),
      kinds.all('radio').map((radio) => radio.getAttribute('value')),
      kinds.all('radio').map((radio) => radio.getAttribute('name')),
      kinds.textContent().includes('Homeschool family'),
      view.attribute('spinbutton', 'Seats', 'name'),
      text.includes('$10 a month'),
      text.includes('1 seat × $10'),
      view.has('button', 'Continue to checkout'),
      text.includes('School name'),
      text.includes('I need a seat myself'),
    ],
    expected: [
      'name',
      ['school', 'family', 'club'],
      ['kind', 'kind', 'kind'],
      true,
      'seats',
      true,
      true,
      true,
      false,
      false,
    ],
  });
});
