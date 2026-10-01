import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  formatDate,
  formatLongDate,
  formatDay,
  formatTime,
  formatWhen,
  shiftMinutes,
} from './dates';

setupRitewayBun();

const at = '2026-10-10T14:05:00.000Z';

describe('tournament dates', () => {
  test('formatting is UTC and fixed-width', () => {
    assert({
      given: 'a UTC timestamp',
      should: 'format the date, day, time and whole moment',
      actual: [formatDate(at), formatDay(at), formatTime(at), formatWhen(at)],
      expected: ['10 Oct', 'Sat 10 Oct', '14:05', 'Sat 10 Oct, 14:05 UTC'],
    });
  });

  test('shifting moves across the day', () => {
    assert({
      given: 'a timestamp shifted back 14 h 6 min',
      should: 'land on the previous day',
      actual: formatWhen(shiftMinutes(at, -(14 * 60 + 6))),
      expected: 'Fri 9 Oct, 23:59 UTC',
    });
  });
});

describe('formatLongDate', () => {
  test('weekday, day, month and year in full', () => {
    assert({
      given: 'a late-summer Saturday',
      should: 'spell it out',
      actual: formatLongDate('2026-08-29T14:00:00.000Z'),
      expected: 'Saturday 29 August 2026',
    });
  });
});
