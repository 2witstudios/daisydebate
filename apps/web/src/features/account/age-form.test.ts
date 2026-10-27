import { assert, setupRitewayBun, test } from 'riteway/bun';
import { birthYears, readAgeForm } from './age-form';

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
