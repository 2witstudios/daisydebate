import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  requireCheckInSegment,
  requireSameCheckIn,
  selectAttendanceSeat,
} from './attendance-decisions';

setupRitewayBun();

const seats = [
  {
    id: 'aff',
    actorId: 'human-a',
    role: 'affirmative',
    kind: 'human',
    eligible: true,
  },
  {
    id: 'neg',
    actorId: 'bot-n',
    role: 'negative',
    kind: 'bot',
    eligible: true,
  },
  {
    id: 'gone',
    actorId: 'human-g',
    role: 'negative',
    kind: 'human',
    eligible: false,
  },
  {
    id: 'judge',
    actorId: 'human-j',
    role: 'judge',
    kind: 'human',
    eligible: true,
  },
] as const;
const human = (actorId: string) => ({ kind: 'human', actorId }) as const;
const bot = (participantId: string, serviceId = 'agent-run:run') =>
  ({
    kind: 'agent',
    serviceId,
    agentRunId: 'run',
    participantId,
    publicationEpoch: 1,
  }) as const;

test('a principal checks in only for its own eligible debating seat', async () => {
  assert({
    given: 'a human for their seat and a bot for its run’s seat',
    should: 'select each seat',
    actual: [
      selectAttendanceSeat(human('human-a'), seats).id,
      selectAttendanceSeat(bot('neg'), seats).id,
    ],
    expected: ['aff', 'neg'],
  });
  for (const [label, principal] of [
    ['an actor with no seat', human('stranger')],
    ['an ineligible seat', human('human-g')],
    ['a judge seat', human('human-j')],
    ['a human acting through a bot seat', human('bot-n')],
    ['a bot naming a human seat', bot('aff')],
    ['a bot with another run’s service', bot('neg', 'agent-run:other')],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse attendance authority',
      actual: () => selectAttendanceSeat(principal, seats),
      code: 'AUTHORIZATION',
    });
});

test('check-ins name an unadjudicated speech segment', async () => {
  const segments = [
    { id: 'ac', type: 'speech' },
    { id: 'cx', type: 'cross_ex' },
    { id: 'nc', type: 'speech' },
  ];
  assert({
    given: 'an open speech segment',
    should: 'return it',
    actual: requireCheckInSegment(segments, 'nc', ['ac']),
    expected: { id: 'nc', type: 'speech' },
  });
  for (const [label, segmentId, finalized] of [
    ['an unknown segment', 'missing', []],
    ['a cross-examination', 'cx', []],
    ['an adjudicated speech', 'ac', ['ac']],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the check-in',
      actual: () => requireCheckInSegment(segments, segmentId, finalized),
      code: 'CONFLICT',
    });
});

test('a replayed check-in must match its receipt', async () => {
  const receipt = { segmentId: 'ac', participantId: 'aff' };
  assert({
    given: 'the same segment and seat',
    should: 'admit the replay',
    actual: requireSameCheckIn(receipt, { ...receipt }),
    expected: undefined,
  });
  for (const expected of [
    { segmentId: 'nc', participantId: 'aff' },
    { segmentId: 'ac', participantId: 'neg' },
  ])
    await assertRejects({
      given: `a replay for ${JSON.stringify(expected)}`,
      should: 'refuse the reused command id',
      actual: () => requireSameCheckIn(receipt, expected),
      code: 'CONFLICT',
    });
});
