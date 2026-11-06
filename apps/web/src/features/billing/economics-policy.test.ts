import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  hasRecordedEconomicsFloor,
  previousEconomicsMonth,
} from './economics-policy';

setupRitewayBun();

test('the completed month uses UTC calendar edges, including January and leap February', () => {
  assert({
    given: 'a January edge, a leap-year March31 and invalid clock text',
    should:
      'select only the preceding complete UTC month without day rollover or a guessed clock',
    actual: [
      '2027-01-01T00:00:00.000Z',
      '2028-03-31T23:59:59.999Z',
      'invalid',
    ].map(previousEconomicsMonth),
    expected: [
      {
        startsAt: '2026-12-01T00:00:00.000Z',
        endsAt: '2027-01-01T00:00:00.000Z',
      },
      {
        startsAt: '2028-02-01T00:00:00.000Z',
        endsAt: '2028-03-01T00:00:00.000Z',
      },
      null,
    ],
  });
});

test('the private measurement feed cannot silently choose a lower floor', () => {
  assert({
    given:
      'the recorded30% floor, explicit unknown, a lower floor and missing input',
    should:
      'accept only the recorded policy or explicit unknown; unknown still cannot become measured',
    actual: [
      { floorBasisPoints: 3000 },
      { floorBasisPoints: null },
      { floorBasisPoints: 1000 },
      {},
      null,
    ].map(hasRecordedEconomicsFloor),
    expected: [true, true, false, false, false],
  });
});
