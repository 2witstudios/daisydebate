import { assert, setupRitewayBun, test } from 'riteway/bun';
import { entriesOfCap, formatUsd, hostingDate } from './hosting-words';

setupRitewayBun();

test('hosting words', () => {
  assert({
    given: 'prices in cents, entry counts with and without a cap, and a date',
    should: 'read as the boards write them',
    actual: [
      formatUsd(9900),
      formatUsd(9900, true),
      formatUsd(10000),
      formatUsd(9950),
      entriesOfCap(16, 16),
      entriesOfCap(1, null),
      entriesOfCap(38, null),
      hostingDate('2026-11-17T10:01:00.000Z'),
    ],
    expected: [
      '$99',
      '$99.00',
      '$100',
      '$99.50',
      '16 of 16 entries',
      '1 entry',
      '38 entries',
      '17 Nov 2026',
    ],
  });
});
