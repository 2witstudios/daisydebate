import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getBracket } from './get-bracket';
import { NOW } from './tournament.test-support';
import { sampleTournamentSource } from '../../ui/mock/tournament-source';

setupRitewayBun();

describe('getBracket', () => {
  test('found, not posted, not found', () => {
    assert({
      given: 'a live tournament, one not started and an unknown id',
      should: 'return bracket, not-posted and not-found',
      actual: [
        getBracket(sampleTournamentSource, 'harvest-cup', true, NOW).kind,
        getBracket(sampleTournamentSource, 'autumn-open', true, NOW).kind,
        getBracket(sampleTournamentSource, 'nope', true, NOW).kind,
      ],
      expected: ['bracket', 'not-posted', 'not-found'],
    });
  });

  test('the viewer handle comes only when signed in', () => {
    const read = (signedIn: boolean) => {
      const result = getBracket(
        sampleTournamentSource,
        'harvest-cup',
        signedIn,
        NOW,
      );
      return result.kind === 'bracket' ? result.viewerHandle : 'x';
    };
    assert({
      given: 'signed in and out',
      should: 'mark the viewer only when signed in',
      actual: [read(true), read(false)],
      expected: ['debater-a', null],
    });
  });
});
