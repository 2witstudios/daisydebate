import { mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noAction, words } from './club-view.test-support';

setupRitewayBun();
const navigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...navigation,
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}));
const { StartClubForm } = await import('./start-club-form');

test('starting a club asks its name, kind and seats, and prices the plan', () => {
  const html = renderToStaticMarkup(<StartClubForm action={noAction} />);
  const text = words(html);
  assert({
    given: 'the Start a club form',
    should: 'offer the three kinds, the seat count and Checkout at $10 a seat',
    actual: [
      html.includes('name="name"'),
      html.includes('value="school"'),
      html.includes('value="family"'),
      html.includes('value="club"'),
      text.includes('Homeschool family'),
      html.includes('name="seats"'),
      text.includes('$10 a month'),
      text.includes('1 seat × $10'),
      text.includes('Continue to checkout'),
      text.includes('School name'),
      text.includes('I need a seat myself'),
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
      false,
      false,
    ],
  });
});
