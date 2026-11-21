import { assert, setupRitewayBun, test } from 'riteway/bun';
import { tournamentFirstDay } from './tournament-schedule';

setupRitewayBun();

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
