import { join } from 'node:path';
import { mock } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

// ISSUE-688: the age step's server action as wired. Only its edges are
// replaced: the request store (next/headers), the in-process age route
// (process-app) and the move-on (form-action); each records into one log.
const log: Array<readonly unknown[]> = [];
let routeAnswer: () => Response = () => Response.json({ recorded: 'recorded' });

mock.module('next/headers', () => ({
  headers: async () => new Headers({ 'next-action': 'age' }),
  cookies: async () => ({
    set: (name: string, value: string, options: unknown) =>
      log.push(['hold', name, value, options]),
  }),
}));
mock.module(join(import.meta.dir, '../../../../server/process-app.ts'), () => ({
  processRoute: () => async () => routeAnswer(),
}));
mock.module(join(import.meta.dir, '../../../../server/form-action.ts'), () => ({
  moveOn: (_incoming: Headers, to: string) => {
    log.push(['moveOn', to]);
    return { kind: 'moved', next: to };
  },
}));

const { ageStepAction } = await import('./actions');
const { AGE_HOLD_COOKIE, AGE_HOLD_COOKIE_OPTIONS } =
  await import('../../../../features/account/age-step');
const { initialAgeForm } =
  await import('../../../../features/account/age-form');

const form = () => {
  const data = new FormData();
  data.set('month', '5');
  data.set('year', '2014');
  data.set('terms', 'accepted');
  return data;
};

const answer = async (response: () => Response) => {
  log.length = 0;
  routeAnswer = response;
  const state = await ageStepAction('/lobby', initialAgeForm, form());
  return { state, log: [...log] };
};

test('the age action holds the browser only for a refusal, before it moves on (ISSUE-688)', async () => {
  const refused = await answer(() =>
    Response.json(
      { error: { code: 'AGE_REFUSED', refusal: 'below-floor' } },
      { status: 403 },
    ),
  );
  const accepted = await answer(() => Response.json({ recorded: 'recorded' }));
  const conflict = await answer(() =>
    Response.json({ error: { code: 'CONFLICT' } }, { status: 409 }),
  );
  assert({
    given:
      'a below-floor refusal, an accepted answer, and a 409 from an account that already answered',
    should:
      'set the shared hold then move on to the age step for the refusal, and move on to the username step with no hold for the others',
    actual: [refused.log, accepted.log, conflict.log],
    expected: [
      [
        ['hold', AGE_HOLD_COOKIE, 'below-floor', AGE_HOLD_COOKIE_OPTIONS],
        ['moveOn', '/onboarding/age?next=%2Flobby'],
      ],
      [['moveOn', '/onboarding/username?next=%2Flobby']],
      [['moveOn', '/onboarding/username?next=%2Flobby']],
    ],
  });
});

test('an unavailable age route keeps every entry and moves nowhere (ISSUE-688)', async () => {
  const unavailable = await answer(
    () => new Response('upstream down', { status: 503 }),
  );
  assert({
    given: 'the age route failing',
    should:
      'return the month, year and Terms the member entered, flagged unavailable, with no hold and no move',
    actual: unavailable,
    expected: {
      state: { kind: 'unavailable', month: '5', year: '2014', terms: true },
      log: [],
    },
  });
});

test('the age action answers exactly one kind for each way the post can end', async () => {
  const accepted = await answer(() => Response.json({ recorded: 'recorded' }));
  const refused = await answer(() =>
    Response.json(
      { error: { code: 'AGE_REFUSED', refusal: 'under-13' } },
      { status: 403 },
    ),
  );
  const incomplete = await ageStepAction(
    '/lobby',
    initialAgeForm,
    new FormData(),
  );
  assert({
    given:
      'an accepted answer, a refusal the age step will show, and a form with nothing chosen',
    should:
      'answer moved to the username step, moved back to the age step, and incomplete naming every field',
    actual: [accepted.state, refused.state, incomplete],
    expected: [
      { kind: 'moved', next: '/onboarding/username?next=%2Flobby' },
      { kind: 'moved', next: '/onboarding/age?next=%2Flobby' },
      {
        kind: 'incomplete',
        month: '',
        year: '',
        terms: false,
        missing: ['month', 'year', 'terms'],
      },
    ],
  });
});
