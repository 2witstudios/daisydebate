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
  reservations: [{ kind: 'casual_ai_judge', source: { kind: 'lifetime' } }],
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
    },
  ],
};
const refused: AllowanceDecision = {
  kind: 'refuse',
  reason: 'free-judge-unbound',
};
const used: AllowanceDecision = {
  kind: 'refuse',
  reason: 'free-limit-reached',
};
const ceiling: AllowanceDecision = { kind: 'refuse', reason: 'abuse-ceiling' };
const lapsed: AllowanceDecision = { kind: 'refuse', reason: 'not-eligible' };

test('a host sees the allowance source for seating a judge in this Room', async () => {
  let reads = 0;
  const read = (decision: AllowanceDecision) => async () => {
    reads++;
    return decision;
  };
  assert({
    given:
      'a casual host included, on the free bundle, unbound, used, at the ceiling, or without the grant',
    should:
      'show included, free, with-bot, premium, fair-use or not-included from the shared allowance decision',
    actual: await Promise.all(
      [included, free, refused, used, ceiling, lapsed].map((decision) =>
        roomAiJudgeSeating(room, 'host', read(decision)),
      ),
    ),
    expected: [
      'included',
      'free',
      'with-bot',
      'premium',
      'fair-use',
      'not-included',
    ],
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
