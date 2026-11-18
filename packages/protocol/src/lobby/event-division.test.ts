import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  divisionAdmission,
  divisionRefusalWords,
  tournamentFirstDay,
} from './event-division';

setupRitewayBun();

test('divisionAdmission', () => {
  assert({
    given:
      'a Youth event and entrants aged 13-15, 16-17 and adult on its first day',
    should: 'admit those under 18 and refuse the adult as over the Youth age',
    actual: [
      divisionAdmission('13-15', 'youth'),
      divisionAdmission('16-17', 'youth'),
      divisionAdmission('adult', 'youth'),
    ],
    expected: [
      { kind: 'admitted' },
      { kind: 'admitted' },
      { kind: 'refused', reason: 'over-youth-age' },
    ],
  });
  assert({
    given: 'an Open event and an adult and a 16-17 year old on its first day',
    should: 'admit the adult and refuse the minor as under the Open age',
    actual: [
      divisionAdmission('adult', 'open'),
      divisionAdmission('16-17', 'open'),
    ],
    expected: [
      { kind: 'admitted' },
      { kind: 'refused', reason: 'under-open-age' },
    ],
  });
  assert({
    given: 'an entrant with no valid age record',
    should: 'refuse them in either division',
    actual: [divisionAdmission(null, 'open'), divisionAdmission(null, 'youth')],
    expected: [
      { kind: 'refused', reason: 'no-age-record' },
      { kind: 'refused', reason: 'no-age-record' },
    ],
  });
});

test('tournamentFirstDay', () => {
  assert({
    given: 'time slots across two days, and a tournament with none yet',
    should: 'take the earliest slot, or now while nothing is scheduled',
    actual: [
      tournamentFirstDay(
        ['2026-12-13T09:00:00.000Z', '2026-12-12T09:00:00.000Z'],
        '2026-11-18T12:00:00.000Z',
      ),
      tournamentFirstDay([], '2026-11-18T12:00:00.000Z'),
    ],
    expected: ['2026-12-12T09:00:00.000Z', '2026-11-18T12:00:00.000Z'],
  });
});

test('divisionRefusalWords', () => {
  assert({
    given: 'each refusal, for the Winter Classic on Sat 12 Dec',
    should: 'say why in the entrant’s terms, naming the ladder and the day',
    actual: [
      divisionRefusalWords('over-youth-age', 'Winter Classic', 'Sat 12 Dec'),
      divisionRefusalWords('under-open-age', 'Spring Open', 'Sat 4 Apr'),
      divisionRefusalWords('no-age-record', 'Winter Classic', 'Sat 12 Dec'),
    ],
    expected: [
      'Winter Classic is Youth – Freestyle, for debaters under 18 on Sat 12 Dec. You’ll be 18, so you debate in Open.',
      'Spring Open is Open – Freestyle, for debaters 18 and over on Sat 4 Apr. You debate in Youth until then.',
      'Winter Classic needs your age to place you in a division. Add it in your account settings.',
    ],
  });
});
