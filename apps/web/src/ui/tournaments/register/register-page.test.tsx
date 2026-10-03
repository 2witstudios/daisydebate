import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTournament } from '../../../features/tournaments/get-tournament';
import {
  defaultRegisterQuery,
  registerFlow,
  type RegisterQuery,
} from '../../../features/tournaments/register-flow';
import { RegisterPage } from './register-page';

setupRitewayBun();

const render = (
  id: string,
  query: Partial<RegisterQuery> = {},
  signedIn = true,
) => {
  const view = getTournament(id, signedIn);
  if (!view) throw new Error(`no sample ${id}`);
  return renderToString(
    h(RegisterPage, {
      screen: registerFlow(view, { ...defaultRegisterQuery, ...query }),
    }),
  );
};

describe('RegisterPage', () => {
  test('eligibility: one h1, the stepper, checks and a Continue link', () => {
    const html = render('weeknight-sprint');
    assert({
      given: 'the first step of an open tournament',
      should: 'name the tournament, list the steps and link Continue to entry',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Register for Weeknight Sprint'),
        html.includes('aria-label="Registration steps"'),
        html.includes('Check you can enter'),
        /href="\/tournaments\/enter\/weeknight-sprint\?step=entry"[^>]*>Continue</.test(
          html,
        ),
        html.includes('aria-label="Your entry"'),
      ],
      expected: [1, true, true, true, true, true],
    });
  });

  test('the conflicts box is typeable and private', () => {
    const html = render('weeknight-sprint');
    assert({
      given: 'the conflicts field',
      should: 'be enabled and say only the pairing system reads it',
      actual: [
        /<textarea[^>]*id="conflicts"/.test(html) &&
          !/<textarea[^>]*disabled/.test(html),
        html.includes('only the pairing system reads this'),
      ],
      expected: [true, true],
    });
  });

  test('entry links back and forward', () => {
    const html = render('weeknight-sprint', { step: 'entry' });
    assert({
      given: 'the entry step',
      should: 'show who enters and link Back and Continue',
      actual: [
        html.includes('You enter as yourself'),
        html.includes('@debater-a'),
        html.includes('href="/tournaments/enter/weeknight-sprint"'),
        html.includes('href="/tournaments/enter/weeknight-sprint?step=review"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('review is a GET form that never carries personal text', () => {
    const html = render('weeknight-sprint', { step: 'review' });
    const names = [
      ...html.matchAll(/<(?:input|textarea)[^>]*name="(\w+)"/g),
    ].map((m) => m[1]);
    assert({
      given: 'the review step',
      should: 'be a GET form to the entry route with step and two ticks only',
      actual: [
        /<form [^>]*method="get"/.test(html),
        /<form [^>]*action="\/tournaments\/enter\/weeknight-sprint"/.test(html),
        names,
        html.includes('Confirm registration'),
        html.includes('Tick both boxes'),
      ],
      expected: [true, true, ['step', 'rules', 'agree'], true, false],
    });
  });

  test('done without both ticks returns to review with the prompt', () => {
    const html = render('weeknight-sprint', { step: 'done', rules: true });
    assert({
      given: 'done with one tick',
      should: 'show review, the alert, and keep the tick',
      actual: [
        html.includes('Review and confirm'),
        /role="alert"[^>]*>Tick both boxes to continue\./.test(html),
        /name="rules"[^>]*checked=""/.test(html) ||
          /checked=""[^>]*name="rules"/.test(html),
      ],
      expected: [true, true, true],
    });
  });

  test('done: registered, and waitlisted for a full tournament', () => {
    const ticks = { step: 'done', rules: true, agree: true } as const;
    const registered = render('weeknight-sprint', ticks);
    const waitlisted = render('night-owl-open', ticks);
    assert({
      given: 'confirmed entries',
      should: 'say registered, or the waitlist position, with withdraw links',
      actual: [
        registered.includes('You are registered'),
        registered.includes('What happens next'),
        registered.includes(
          'href="/tournaments/enter/weeknight-sprint/withdraw"',
        ),
        waitlisted.includes('You are on the waitlist'),
        waitlisted.includes('Position 3.'),
        waitlisted.includes('Leave the waitlist'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('a full tournament shows the full notice and waitlist wording', () => {
    const html = render('night-owl-open');
    assert({
      given: 'a full tournament, first step',
      should: 'explain the waitlist',
      actual: html.includes('This tournament is full. All 8 places are taken'),
      expected: true,
    });
  });

  test('refusals replace the flow', () => {
    const band = render('bronze-cup');
    const closed = render('frost-cup');
    const none = render('autumn-open', {}, false);
    assert({
      given: 'a band refusal, a closed tournament and a viewer with no profile',
      should: 'show the refusal with its way out and no stepper',
      actual: [
        band.includes('This tournament is for ratings 1000 to 1400'),
        band.includes('Your rating is 1620'),
        closed.includes('Registration is closed'),
        closed.includes('href="/tournaments/frost-cup/bracket"'),
        none.includes('Create a debater profile first'),
        none.includes(
          'href="/onboarding/username?next=%2Ftournaments%2Fenter%2Fautumn-open"',
        ),
        band.includes('Registration steps'),
      ],
      expected: [true, true, true, true, true, true, false],
    });
  });
});
