import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from './index';

setupRitewayBun();

describe('utteranceOperations', () => {
  test('exposes transcript reads without retired unscoped write or usage authority', async () => {
    const database = createDatabase({
      url: 'postgresql://unused@127.0.0.1:1/unused',
      nextActorId: () => {
        throw new Error('Surface inspection requires no actor');
      },
    });
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
        given:
          'the shared database root after signed capture/scoped bot cutover',
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
      await database.close();
    }
  });
});
