import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clockDuration,
  durationParts,
  readDuration,
  formatDuration,
} from './duration-input';

setupRitewayBun();

test('minutes and residual decimal seconds round-trip exact milliseconds', () => {
  const values = [0, 1, 444, 59999, 60000, 98765, 887000];
  assert({
    given: 'legal durations at millisecond and minute boundaries',
    should: 'round-trip without floating point rounding or truncation',
    actual: values.map((ms) => {
      const parts = durationParts(ms);
      const form = new FormData();
      form.set('duration.test.minutes', parts.minutes);
      form.set('duration.test.seconds', parts.seconds);
      return readDuration(form, 'test');
    }),
    expected: values,
  });
  assert({
    given: 'a saved asymmetric speech with millisecond precision',
    should: 'show readable units with the complete exact duration',
    actual: formatDuration(98765),
    expected: '1 min 38.765 sec',
  });
});

test('duration parsing rejects malformed or noncanonical component values', () => {
  const pairs = [
    ['1.5', '0'],
    ['-1', '0'],
    ['0', '60'],
    ['0', '1.0001'],
    ['0', '1e1'],
    ['', '1'],
    ['1', ''],
    ['9007199254740991', '0'],
  ];
  assert({
    given:
      'fractional minutes, overflow seconds, excess precision or missing components',
    should: 'refuse every value rather than normalize a malformed draft',
    actual: pairs.map(([minutes, seconds]) => {
      const form = new FormData();
      form.set('duration.test.minutes', minutes!);
      form.set('duration.test.seconds', seconds!);
      return Number.isNaN(readDuration(form, 'test'));
    }),
    expected: pairs.map(() => true),
  });
});

test('clock durations read as a round clock without losing precision', () => {
  assert({
    given: 'whole minutes, residual seconds and a millisecond override',
    should: 'render minutes and padded seconds, keeping the exact remainder',
    actual: [300000, 120000, 5000, 98765, 0].map(clockDuration),
    expected: ['5:00', '2:00', '0:05', '1:38.765', '0:00'],
  });
});
