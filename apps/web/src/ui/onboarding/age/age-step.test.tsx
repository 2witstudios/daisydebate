import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { AgeRefusalStep } from './age-refusal';

setupRitewayBun();
await mockNextRouter();
const { AgeStep } = await import('./age-step');

test('the age step asks month and year neutrally, with the Terms', () => {
  const html = renderToStaticMarkup(
    <AgeStep action={async (state) => state} years={[2026, 2025, 1990]} />,
  );
  assert({
    given: 'a new account at the age step',
    should:
      'offer required month and year selects with an empty first choice, a required Terms and Privacy checkbox, and no age cutoff',
    actual: [
      html.includes('When were you born?'),
      /<select name="month" aria-label="Month" required=""[^>]*><option value="" selected="">Month<\/option>/.test(
        html,
      ),
      /<select name="year" aria-label="Year" required=""[^>]*><option value="" selected="">Year<\/option>/.test(
        html,
      ),
      html.includes('<option value="12">December</option>'),
      html.includes('<option value="1990">1990</option>'),
      /<input type="checkbox" required=""[^>]*name="terms" value="accepted"/.test(
        html,
      ),
      html.includes('href="/terms"') && html.includes('href="/privacy"'),
      /\b1[36]\b/.test(html.replace(/<[^>]+>/g, ' ')),
    ],
    expected: [true, true, true, true, true, true, true, false],
  });
});

test('below the floor, a neutral signed-out page keeps nothing', () => {
  const child = renderToStaticMarkup(<AgeRefusalStep refusal="under-13" />);
  const teen = renderToStaticMarkup(<AgeRefusalStep refusal="below-floor" />);
  assert({
    given: 'an under-13 answer, then a 13-15 answer during the beta',
    should:
      'say Daisy is for 13 and older, then that the beta is open to 16 and older, each with nothing kept and no form',
    actual: [
      child.includes('Daisy is for people 13 and older.'),
      teen.includes('The Daisy beta is open to people 16 and older for now.'),
      child.includes('We haven’t kept anything you entered.') &&
        teen.includes('We haven’t kept anything you entered.'),
      child.includes('<form') || teen.includes('<form'),
    ],
    expected: [true, true, true, false],
  });
});
