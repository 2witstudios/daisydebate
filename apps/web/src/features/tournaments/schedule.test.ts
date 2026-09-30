import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundLabels, scheduleFor } from './schedule';
import { tournament } from './tournament.test-support';

setupRitewayBun();

describe('roundLabels', () => {
  test('elimination rounds are named from the final back', () => {
    assert({
      given: '8, 16 and 64 places and a round robin of 8 and 5',
      should: 'name the bracket rounds and number the robin rounds',
      actual: [
        roundLabels('single-elimination', 8),
        roundLabels('single-elimination', 16),
        roundLabels('single-elimination', 64).length,
        roundLabels('round-robin', 8).length,
        roundLabels('round-robin', 5).length,
      ],
      expected: [
        ['Quarterfinals', 'Semifinals', 'Final'],
        ['Round of 16', 'Quarterfinals', 'Semifinals', 'Final'],
        6,
        7,
        5,
      ],
    });
  });
});

describe('scheduleFor', () => {
  test('registration close, bracket post and rounds in order', () => {
    const items = scheduleFor(tournament({ places: 8 }));
    assert({
      given: 'an 8-place bracket starting 10 Oct 14:00 UTC',
      should: 'list close, post and three rounds 90 minutes apart',
      actual: items.map(({ label, note, at }) => [
        label,
        note,
        at.slice(5, 16),
      ]),
      expected: [
        ['Registration closes', 'Seeds are set by rating', '10-08T18:00'],
        ['Bracket published', 'Byes go to the top seeds', '10-08T19:00'],
        ['Quarterfinals', 'Check-in opens 13:50', '10-10T14:00'],
        ['Semifinals', '', '10-10T15:30'],
        ['Final', 'Open to spectators', '10-10T17:00'],
      ],
    });
  });

  test('without a registration window there is no close row', () => {
    const items = scheduleFor(
      tournament({
        places: 4,
        registrationClosesAt: null,
        structure: 'round-robin',
      }),
    );
    assert({
      given: 'a round robin of 4 with no close time',
      should: 'list only its three rounds',
      actual: items.map((item) => item.label),
      expected: ['Round 1', 'Round 2', 'Round 3'],
    });
  });
});
