import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { AgeRefusalStep } from './age-refusal';
import { YouthLanding } from './youth-landing';

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

test('under 13, a neutral signed-out page keeps nothing', () => {
  const child = renderToStaticMarkup(<AgeRefusalStep refusal="under-13" />);
  assert({
    given: 'an under-13 answer',
    should:
      'say Daisy is for 13 and older, with nothing kept, no form and no other age named',
    actual: [
      child.includes('Daisy is for people 13 and older.'),
      child.includes('We haven’t kept anything you entered.'),
      child.includes('<form'),
      /\b16\b/.test(child.replace(/<[^>]+>/g, ' ')),
    ],
    expected: [true, true, false, false],
  });
});

test('a member aged 13 to 17 is told they are in the Youth lobby, then goes on', () => {
  const html = renderToStaticMarkup(
    <YouthLanding
      next="/onboarding/username?next=%2Flobby"
      lobbyName="Youth"
    />,
  );
  assert({
    given: 'the landing after the age step for a Youth member',
    should:
      'name the Youth lobby and link on to the username step without a form',
    actual: [
      html.includes('You’re in the Youth lobby'),
      html.includes('Thanks. Here’s where you’ll play.'),
      html.includes('href="/onboarding/username?next=%2Flobby"'),
      html.includes('Next: choose your username.'),
      html.includes('<form'),
    ],
    expected: [true, true, true, true, false],
  });
});
