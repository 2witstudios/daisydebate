import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTournament } from './get-tournament';

setupRitewayBun();

describe('getTournament', () => {
  test('an unknown id is null', () => {
    assert({
      given: 'an id no tournament has',
      should: 'return null',
      actual: getTournament('nope', true),
      expected: null,
    });
  });

  test('the registration state follows the tournament and the viewer', () => {
    const state = (id: string, signedIn = true) =>
      getTournament(id, signedIn)?.state;
    assert({
      given: 'each sample tournament kind',
      should: 'name every panel state',
      actual: [
        state('weeknight-sprint'),
        state('autumn-open'),
        state('night-owl-open'),
        state('novice-cup'),
        state('hollow-cup'),
        state('winter-open'),
        state('harvest-cup'),
        state('club-championship'),
        state('summer-invitational'),
        state('autumn-open', false),
      ],
      expected: [
        'open',
        'registered',
        'full',
        'waitlisted',
        'closed',
        'not-open',
        'competing',
        'in-progress',
        'completed',
        'signed-out',
      ],
    });
  });

  test('the detail carries schedule, recognition and entrants', () => {
    const view = getTournament('autumn-open', true);
    assert({
      given: 'Autumn Open',
      should: 'list 24 entrants, 7 schedule rows and 4 honours',
      actual: [
        view?.entrants.length,
        view?.entrants[0]?.handle,
        view?.schedule.length,
        view?.recognition.length,
      ],
      expected: [24, 'debater-a', 7, 4],
    });
  });
});
