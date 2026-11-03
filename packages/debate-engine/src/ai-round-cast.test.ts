import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomParticipant } from '@daisy/protocol';
import { castSeatsBotDebater } from './ai-round-cast';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';

setupRitewayBun();

const seat = (
  kind: RoomParticipant['kind'],
  role: RoomParticipant['role'],
) => ({ kind, role });
const human = (role: RoomParticipant['role']) => seat('human', role);
const bot = (role: RoomParticipant['role']) => seat('bot', role);

const casts = [
  ['a bot debater against a human', [human('affirmative'), bot('negative')]],
  [
    'two bot debaters and an AI judge',
    [bot('affirmative'), bot('negative'), bot('judge')],
  ],
  [
    'a bot debater and an AI judge',
    [human('affirmative'), bot('negative'), bot('judge')],
  ],
  [
    'human debaters with only an AI judge',
    [human('affirmative'), human('negative'), bot('judge')],
  ],
  [
    'human debaters and a human judge',
    [human('affirmative'), human('negative'), human('judge')],
  ],
] as const;

test('castSeatsBotDebater()', () => {
  assert({
    given: 'bot-debater, mixed, AI-judge-only, and human-only casts',
    should: 'answer true exactly when a bot debates',
    actual: casts.map(([given, participants]) => [
      given,
      castSeatsBotDebater({ participants: participants as never }),
    ]),
    expected: [
      ['a bot debater against a human', true],
      ['two bot debaters and an AI judge', true],
      ['a bot debater and an AI judge', true],
      ['human debaters with only an AI judge', false],
      ['human debaters and a human judge', false],
    ],
  });
});

test('a real Launch carries the cast consequence in its freeze', () => {
  const room = state();
  const [host, other] = room.participants;
  const bot = { kind: 'bot' as const, consentCommandId: null };
  const casts = {
    'a bot debater': { ...room, participants: [host!, { ...other!, ...bot }] },
    'an AI judge alone': {
      ...room,
      rules: { ...room.rules, seats: { ...room.rules.seats, judge: 1 } },
      participants: [
        host!,
        other!,
        {
          ...other!,
          ...bot,
          id: 'p3',
          actorId: 'judge',
          role: 'judge' as const,
        },
      ],
    },
    'humans only': room,
  };
  assert({
    given:
      'start-round on a bot-debater cast, an AI-judge-only cast and a human-only cast',
    should:
      'freeze each, spending an AI round and a capacity slot only for the bot debater',
    actual: Object.entries(casts).map(([given, cast]) => {
      const result = executeRoomCommand(
        cast,
        'host',
        { commandId: 'start', expectedVersion: 4, type: 'start-round' },
        consent,
        edges,
      );
      return [
        given,
        result.ok && result.mutation.freeze,
        result.ok && result.mutation.seatsBotDebater,
      ];
    }),
    expected: [
      ['a bot debater', true, true],
      ['an AI judge alone', true, false],
      ['humans only', true, false],
    ],
  });
});
