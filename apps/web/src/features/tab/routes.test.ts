import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isTabPath, participantPathOf } from './routes';

setupRitewayBun();

describe('participantPathOf', () => {
  test('the same path without the prefix', () => {
    assert({
      given: 'host addresses the participant side also has',
      should: 'drop only the /host prefix',
      actual: [
        participantPathOf('/host/tournaments/autumn-open/standings'),
        participantPathOf(
          '/host/tournaments/autumn-open/events/varsity-debate/rounds/3',
        ),
        participantPathOf('/host/leagues/southeast'),
      ],
      expected: [
        '/tournaments/autumn-open/standings',
        '/tournaments/autumn-open/events/varsity-debate/rounds/3',
        '/leagues/southeast',
      ],
    });
  });

  test('a page only a host has', () => {
    assert({
      given: 'host home, setup, a time slot, an event ballot and league people',
      should: 'give the nearest participant page above it',
      actual: [
        participantPathOf('/host'),
        participantPathOf('/host/tournaments/autumn-open/setup'),
        participantPathOf('/host/tournaments/winter-classic/slots/1200'),
        participantPathOf(
          '/host/tournaments/autumn-open/events/varsity-debate/ballot',
        ),
        participantPathOf('/host/leagues/southeast/people'),
      ],
      expected: [
        '/tournaments',
        '/tournaments/autumn-open',
        '/tournaments/winter-classic',
        '/tournaments/autumn-open',
        '/leagues/southeast',
      ],
    });
  });
});

describe('isTabPath', () => {
  test('a path a form sent back', () => {
    assert({
      given:
        'Tab pages, another page, and paths carrying a query, host or parent step',
      should: 'accept only bare Tab paths',
      actual: [
        '/host',
        '/host/tournaments/autumn-open/setup',
        '/rooms/sample/semifinal-room-1/ballot',
        '/family/ada',
        '/settings',
        '/rooms/abc',
        '/hostile',
        '/tournaments/x?did=1',
        '//evil.example/host',
        '/host/../settings',
      ].map(isTabPath),
      expected: [
        true,
        true,
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
      ],
    });
  });
});
