import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomParticipant } from '@daisy/protocol';
import { castSpendsAiRound } from './ai-round-cast';

setupRitewayBun();

const seat = (
  kind: RoomParticipant['kind'],
  role: RoomParticipant['role'],
) => ({ kind, role });
const human = (role: RoomParticipant['role']) => seat('human', role);
const bot = (role: RoomParticipant['role']) => seat('bot', role);

test('castSpendsAiRound()', () => {
  const casts = [
    [
      'a bot debater against a human',
      'casual',
      [human('affirmative'), bot('negative')],
    ],
    [
      'two bot debaters and an AI judge',
      'casual',
      [bot('affirmative'), bot('negative'), bot('judge')],
    ],
    [
      'a bot debater and an AI judge',
      'casual',
      [human('affirmative'), bot('negative'), bot('judge')],
    ],
    [
      'human debaters with only an AI judge',
      'casual',
      [human('affirmative'), human('negative'), bot('judge')],
    ],
    [
      'human debaters and a human judge',
      'casual',
      [human('affirmative'), human('negative'), human('judge')],
    ],
    [
      'a ranked Round with a bot debater',
      'ranked',
      [human('affirmative'), bot('negative')],
    ],
  ] as const;
  assert({
    given: 'bot-debater, mixed, AI-judge-only, human-only and ranked casts',
    should: 'spend an allowance only when a bot debates outside ranked play',
    actual: casts.map(([given, competitionType, participants]) => [
      given,
      castSpendsAiRound({
        competitionType,
        participants: participants as never,
      }),
    ]),
    expected: [
      ['a bot debater against a human', true],
      ['two bot debaters and an AI judge', true],
      ['a bot debater and an AI judge', true],
      ['human debaters with only an AI judge', false],
      ['human debaters and a human judge', false],
      ['a ranked Round with a bot debater', false],
    ],
  });
});
