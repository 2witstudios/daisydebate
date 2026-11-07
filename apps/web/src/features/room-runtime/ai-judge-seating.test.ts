import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AllowanceDecision } from '@daisy/protocol/billing';
import { roomAiJudgeSeating } from './ai-judge-seating';

setupRitewayBun();
const room = {
  hostActorId: 'host',
  status: 'assembling',
  competitionType: 'casual',
} as const;
const free: AllowanceDecision = {
  kind: 'admit',
  reservations: [
    { kind: 'casual_ai_judge', source: { kind: 'lifetime' }, limit: 1 },
  ],
};
const included: AllowanceDecision = {
  kind: 'admit',
  reservations: [
    {
      kind: 'casual_ai_judge',
      source: {
        kind: 'beta',
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-12-01T00:00:00.000Z',
      },
      limit: null,
    },
  ],
};
const refused: AllowanceDecision = {
  kind: 'refuse',
  reason: 'free-judge-unbound',
};

test('a host sees the allowance source for seating a judge in this Room', async () => {
  let reads = 0;
  const read = (decision: AllowanceDecision) => async () => {
    reads++;
    return decision;
  };
  assert({
    given:
      'a casual host with an included source, initial free bundle or refused allowance',
    should: 'show included, free or Premium from the shared allowance decision',
    actual: await Promise.all(
      [included, free, refused].map((decision) =>
        roomAiJudgeSeating(room, 'host', read(decision)),
      ),
    ),
    expected: ['included', 'free', 'premium'],
  });
  reads = 0;
  assert({
    given: 'a ranked host, non-host, and started or closed Room',
    should: 'answer without reading private allowance',
    actual: [
      await roomAiJudgeSeating(
        { ...room, competitionType: 'ranked' },
        'host',
        read(refused),
      ),
      await roomAiJudgeSeating(room, 'someone', read(free)),
      await roomAiJudgeSeating(
        { ...room, status: 'started' },
        'host',
        read(free),
      ),
      await roomAiJudgeSeating(
        { ...room, status: 'closed' },
        'host',
        read(free),
      ),
      reads,
    ],
    expected: ['free', null, null, null, 0],
  });
});
