import { assert, setupRitewayBun, test } from 'riteway/bun';
import { clockDuration, readDuration } from './duration-input';

setupRitewayBun();

const read = (text: string) => {
  const form = new FormData();
  form.set('duration.test', text);
  return readDuration(form, 'test');
};

test('a clock reading round-trips exact milliseconds', () => {
  const values = [0, 1, 444, 59999, 60000, 98765, 887000];
  assert({
    given: 'legal durations at millisecond and minute boundaries',
    should: 'read back from their m:ss text without rounding or truncation',
    actual: values.map((ms) => read(clockDuration(ms))),
    expected: values,
  });
});

test('a duration is typed as minutes and seconds', () => {
  assert({
    given: 'm:ss text, a single-digit second and surrounding spaces',
    should: 'read minutes and seconds as milliseconds',
    actual: ['5:00', '0:30', ' 2:05 ', '12:00'].map(read),
    expected: [300000, 30000, 125000, 720000],
  });
});

test('duration parsing rejects malformed or noncanonical values', () => {
  const texts = [
    '',
    '5',
    '1.5:00',
    '-1:00',
    '0:60',
    '0:5',
    '0:01.0001',
    '1e1:00',
    ':30',
    '5:00:00',
    '9007199254740991:00',
  ];
  assert({
    given:
      'bare numbers, overflow seconds, excess precision or missing components',
    should: 'refuse every value rather than normalize a malformed draft',
    actual: texts.map((text) => Number.isNaN(read(text))),
    expected: texts.map(() => true),
  });
  assert({
    given: 'no field at all',
    should: 'refuse the missing value',
    actual: Number.isNaN(readDuration(new FormData(), 'test')),
    expected: true,
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
