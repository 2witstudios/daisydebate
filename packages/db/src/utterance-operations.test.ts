import { virtualClock } from '@daisy/clock/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { openDatabaseResources } from './resources';
import { createRoundStore } from './stores/rounds';

setupRitewayBun();

describe('utteranceOperations', () => {
  test('exposes transcript reads without retired unscoped write or usage authority', async () => {
    const resources = openDatabaseResources({
      url: 'postgresql://unused@127.0.0.1:1/unused',
      waits: virtualClock(),
    });
    const database = createRoundStore(resources);
    const retired = [
      'appendUtterance',
      'replaceUtterance',
      'claimSpeech',
      'releaseSpeech',
      'reserveAiPractice',
      'markReservationCounted',
      'countRecentAiPractice',
      'countLiveRounds',
      'recordAgentRun',
      'spokenCharactersFor',
      'reserveSpokenCharacters',
    ];
    try {
      assert({
        given: 'the Round store after signed capture/scoped bot cutover',
        should:
          'expose only the retained transcript readers and no retired authority',
        actual: {
          retired: retired.filter((name) => Object.hasOwn(database, name)),
          readers: [
            typeof database.listSegmentUtterances,
            typeof database.listRoundUtterances,
          ],
        },
        expected: { retired: [], readers: ['function', 'function'] },
      });
    } finally {
      await resources.close();
    }
  });
});
