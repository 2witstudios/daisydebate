import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { displayStatus } from './status';

setupRitewayBun();

describe('displayStatus', () => {
  const cases = [
    [
      'appearing offline, in a Round',
      { chosen: 'appearing_offline', activity: 'active', placement: 'round' },
      'offline',
    ],
    [
      'no lease, chose online',
      { chosen: 'online', activity: null, placement: null },
      'offline',
    ],
    [
      'in a Round, chose busy',
      { chosen: 'busy', activity: 'active', placement: 'round' },
      'round',
    ],
    [
      'in a room, idle',
      { chosen: 'online', activity: 'idle', placement: 'room' },
      'room',
    ],
    [
      'busy and idle',
      { chosen: 'busy', activity: 'idle', placement: null },
      'busy',
    ],
    [
      'online and active',
      { chosen: 'online', activity: 'active', placement: null },
      'online',
    ],
    [
      'online and idle',
      { chosen: 'online', activity: 'idle', placement: null },
      'away',
    ],
  ] as const;
  for (const [given, input, expected] of cases)
    test(given, () => {
      assert({
        given,
        should: `show ${expected}`,
        actual: displayStatus(input),
        expected,
      });
    });
});
