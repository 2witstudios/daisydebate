import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getEvent } from './get-event';
import { NOW } from './tournament.test-support';
import { sampleTournamentSource } from '../../ui/mock/tournament-source';

setupRitewayBun();

describe('getEvent', () => {
  test('the viewer competes in Harvest Cup only', () => {
    assert({
      given:
        'Harvest Cup, an entered but not competing tournament, and an unknown id',
      should: 'return the event only for Harvest Cup',
      actual: [
        getEvent(sampleTournamentSource, 'harvest-cup', NOW)?.tournament.name,
        getEvent(sampleTournamentSource, 'autumn-open', NOW),
        getEvent(sampleTournamentSource, 'nope', NOW),
      ],
      expected: ['Harvest Cup', null, null],
    });
  });
});
