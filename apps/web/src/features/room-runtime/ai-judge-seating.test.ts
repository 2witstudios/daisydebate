import { assert, setupRitewayBun, test } from 'riteway/bun';
import { hostHoldsCasualAiJudge, roomAiJudgeSeating } from './ai-judge-seating';

setupRitewayBun();

const room = {
  hostActorId: 'host',
  status: 'assembling',
  competitionType: 'casual',
} as const;

test('a host sees what seating an AI judge means in this Room', async () => {
  let reads = 0;
  const read = (held: boolean) => async () => {
    reads += 1;
    return held;
  };
  assert({
    given: 'a casual host with and without the entitlement',
    should: 'say included, else premium',
    actual: [
      await roomAiJudgeSeating(room, 'host', read(true)),
      await roomAiJudgeSeating(room, 'host', read(false)),
    ],
    expected: ['included', 'premium'],
  });
  reads = 0;
  assert({
    given: 'a ranked host, a non-host, and a started or closed Room',
    should: 'answer without reading any grant',
    actual: [
      await roomAiJudgeSeating(
        { ...room, competitionType: 'ranked' },
        'host',
        read(false),
      ),
      await roomAiJudgeSeating(room, 'someone', read(true)),
      await roomAiJudgeSeating(
        { ...room, status: 'started' },
        'host',
        read(true),
      ),
      await roomAiJudgeSeating(
        { ...room, status: 'closed' },
        'host',
        read(true),
      ),
      reads,
    ],
    expected: ['free', null, null, null, 0],
  });
});

test('the casual AI judge entitlement comes from its own grant', () => {
  const beta = { entitlement: 'casual_ai_judge', source: 'beta' } as const;
  assert({
    given: 'a beta grant with the switch on and off, and only other grants',
    should: 'hold it only for its own counted grant',
    actual: [
      hostHoldsCasualAiJudge([beta], true),
      hostHoldsCasualAiJudge([beta], false),
      hostHoldsCasualAiJudge(
        [
          { entitlement: 'round_analysis', source: 'beta' },
          { entitlement: 'ai_rounds', source: 'beta' },
        ],
        true,
      ),
    ],
    expected: [true, false, false],
  });
});
