import { assert, setupRitewayBun, test } from 'riteway/bun';
import { formatInboxTime } from './inbox-time';
setupRitewayBun();
test('inbox times are compact ages, then dates', () => {
  const now = '2026-10-26T18:00:00.000Z';
  assert({
    given: 'activity across the last week and beyond',
    should: 'read as now, minutes, hours, days, then a date',
    actual: [
      '2026-10-26T17:59:30.000Z',
      '2026-10-26T17:15:00.000Z',
      '2026-10-26T09:00:00.000Z',
      '2026-10-23T18:00:00.000Z',
      '2026-10-03T12:00:00.000Z',
      '2025-12-31T12:00:00.000Z',
      '2026-10-26T18:00:05.000Z',
    ].map((at) => formatInboxTime(at, now)),
    expected: ['now', '45m', '9h', '3d', 'Oct 3', 'Dec 31, 2025', 'now'],
  });
});
