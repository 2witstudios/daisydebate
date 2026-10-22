import { assert, setupRitewayBun, test } from 'riteway/bun';
import { attendanceReceiptTime, attendanceTimestamp } from './receipt-time';
setupRitewayBun();
test('native deadline and horizon timestamps round trip without flooring microseconds', () => {
  const instants = [
    '2026-10-22T00:00:40.000001Z',
    '2026-10-22T00:00:39.999999Z',
  ];
  assert({
    given: 'deadline or horizon inherited from PG microsecond boundary',
    should: 'preserve all six digits on durable serialization',
    actual: instants.map((iso) =>
      attendanceTimestamp(attendanceReceiptTime(iso)),
    ),
    expected: instants,
  });
});
test('PostgreSQL receipt microseconds do not move a late stamp onto the deadline', () => {
  const exact = '2026-10-22T00:00:40.000000Z';
  assert({
    given: 'receipt one microsecond beyond exact deadline',
    should: 'remain strictly late rather than Date-truncated on time',
    actual:
      attendanceReceiptTime('2026-10-22T00:00:40.000001Z') >
      attendanceReceiptTime(exact),
    expected: true,
  });
  assert({
    given: 'receipt one microsecond before early lead boundary',
    should: 'remain strictly early',
    actual:
      attendanceReceiptTime('2026-10-22T00:00:39.999999Z') <
      attendanceReceiptTime(exact),
    expected: true,
  });
});
