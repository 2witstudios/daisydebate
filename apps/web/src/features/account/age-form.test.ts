import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ageAnswerHref,
  birthYears,
  readAgeAnswer,
  readAgeForm,
} from './age-form';

setupRitewayBun();

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
};

test('the age form reads as the route body or names what is missing', () => {
  assert({
    given: 'a full answer, then one with no month and Terms not ticked',
    should:
      'post the month, year and acceptance, then keep the year and name the month and Terms',
    actual: [
      readAgeForm(form({ month: '3', year: '2001', terms: 'accepted' })),
      readAgeForm(form({ month: '', year: '2001' })),
    ],
    expected: [
      { ok: true, body: { month: 3, year: 2001, terms: true } },
      {
        ok: false,
        state: {
          month: '',
          year: '2001',
          terms: false,
          missing: ['month', 'terms'],
        },
      },
    ],
  });
});

test('the year choices run from this year back a century', () => {
  const years = birthYears('2026-10-26T00:00:00.000Z');
  assert({
    given: 'the server’s time in 2026',
    should: 'offer 2026 first and 1926 last',
    actual: [years[0], years.at(-1), years.length],
    expected: [2026, 1926, 101],
  });
});

test('what the age route answered, for the form action', async () => {
  const refusal = (value: unknown) =>
    Response.json(
      { error: { code: 'AGE_REFUSED', refusal: value } },
      { status: 403 },
    );
  assert({
    given:
      'a recorded answer, a 409 (this account answered already), the two refusals, a 403 without a refusal and a 500',
    should:
      'move on for the first two (the first answer stands), hold the browser for a refusal, and say it was unavailable otherwise',
    actual: await Promise.all(
      [
        Response.json({ recorded: 'recorded' }),
        Response.json({ error: { code: 'CONFLICT' } }, { status: 409 }),
        refusal('under-13'),
        refusal('below-floor'),
        refusal('anything-else'),
        new Response('oops', { status: 500 }),
      ].map(readAgeAnswer),
    ),
    expected: [
      { kind: 'accepted' },
      { kind: 'accepted' },
      { kind: 'refused', refusal: 'under-13' },
      { kind: 'refused', refusal: 'below-floor' },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});

test('where the form goes after the answer, keeping the destination', async () => {
  const conflict = await readAgeAnswer(
    Response.json({ error: { code: 'CONFLICT' } }, { status: 409 }),
  );
  assert({
    given:
      'a 409 for an account that answered already, a refusal and an unavailable route, each with the destination /ranked',
    should:
      'go on to the username step with next kept, back to the age step with next kept, and stay put',
    actual: [
      ageAnswerHref(conflict, '/ranked'),
      ageAnswerHref({ kind: 'refused', refusal: 'under-13' }, '/ranked'),
      ageAnswerHref({ kind: 'unavailable' }, '/ranked'),
    ],
    expected: [
      '/onboarding/username?next=%2Franked',
      '/onboarding/age?next=%2Franked',
      null,
    ],
  });
});
