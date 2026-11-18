import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ACCOUNT_AGE_FLOOR,
  ADMITTED_AGE_BANDS,
  memberFloorDecision,
} from './age-floor';

setupRitewayBun();

const at = (iso: string) => new Date(iso);

test('the one trusted floor is 13 (decision 88)', () => {
  assert({
    given: 'the account age floor and the bands it admits',
    should: 'be 13, admitting every band from 13-15 up',
    actual: [ACCOUNT_AGE_FLOOR, ADMITTED_AGE_BANDS],
    expected: [13, ['13-15', '16-17', 'adult']],
  });
});

test('the member floor refuses under 13 and admits from the month of the 13th birthday', () => {
  const now = at('2026-11-18T12:00:00.000Z');
  assert({
    given: 'birth months of 12 years 11 months, exactly 13, 15, 16 and 40',
    should: 'refuse only the 12-year-old, as under 13, and band the rest',
    actual: [
      memberFloorDecision('2013-12', now),
      memberFloorDecision('2013-11', now),
      memberFloorDecision('2011-06', now),
      memberFloorDecision('2010-11', now),
      memberFloorDecision('1986-01', now),
    ],
    expected: [
      { outcome: 'refused', refusal: 'under-13' },
      { outcome: 'admitted', band: '13-15' },
      { outcome: 'admitted', band: '13-15' },
      { outcome: 'admitted', band: '16-17' },
      { outcome: 'admitted', band: 'adult' },
    ],
  });
});

test('the birth-month boundary turns at UTC midnight on the 1st', () => {
  assert({
    given: 'a birth month of 2013-12, just before and at 2026-12-01T00:00Z',
    should:
      'refuse on the last instant of November and admit on the first of December',
    actual: [
      memberFloorDecision('2013-12', at('2026-11-30T23:59:59.999Z')),
      memberFloorDecision('2013-12', at('2026-12-01T00:00:00.000Z')),
    ],
    expected: [
      { outcome: 'refused', refusal: 'under-13' },
      { outcome: 'admitted', band: '13-15' },
    ],
  });
});
