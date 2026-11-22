import { createRoundRuntime } from '@daisy/debate-engine';
import { roundRulesSchema } from '@daisy/protocol/format';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { agentSeedRound, agentSeedUsers, agentSeedVersion } from './agent-seed';

setupRitewayBun();

const t0 = '2026-01-01T00:00:00.000Z';

/** The seed as a runtime: the proof that its frozen rules actually execute. */
const seedRuntime = () =>
  createRoundRuntime({
    round: {
      id: agentSeedRound.id,
      status: 'opening',
      currentStage: null,
      startedAt: null,
      completedAt: null,
      outcome: null,
    },
    rules: agentSeedRound.rules,
    participants: [...agentSeedRound.seats],
    checkpoint: null,
    segments: [],
    nextSegmentId: () => 'segment-seed',
  });

describe('agentSeedRound', () => {
  test('stores rules the protocol contract and the runtime both accept', () => {
    const world = seedRuntime();
    world.activate({ at: t0, now: t0 });
    const position = world.position(t0);
    assert({
      given: 'the seeded round rules and seats',
      should:
        'parse through the protocol contract and start into the countdown',
      actual: {
        parsed: roundRulesSchema.safeParse(agentSeedRound.rules).success,
        status: position.status,
        stage: position.stage,
        next: position.nextSegment?.key,
      },
      expected: {
        parsed: true,
        status: 'active',
        stage: 'countdown',
        next: 'AC',
      },
    });
  });

  test('seats the two agent actors on the sides the rules freeze', () => {
    assert({
      given: 'the seeded round seats',
      should: 'hold each agent actor once, one per side, at slot zero',
      actual: agentSeedRound.seats.map(({ actorId, seat }) => ({
        actorId,
        seat,
      })),
      expected: [
        {
          actorId: agentSeedUsers[0].actorId,
          seat: { kind: 'side', side: 'affirmative', slot: 0 },
        },
        {
          actorId: agentSeedUsers[1].actorId,
          seat: { kind: 'side', side: 'negative', slot: 0 },
        },
      ],
    });
    assert({
      given: 'the seeded seats',
      should: 'match the seat counts the resolved rules demand',
      actual: agentSeedRound.rules.seats,
      expected: {
        sides: { affirmative: 1, negative: 1 },
        speakers: 0,
        judges: 0,
        moderators: 0,
      },
    });
  });

  test('marks the rules-carrying seed content with a new version', () => {
    assert({
      given: 'seed content that moved onto seats by kind and side (TAB-6)',
      should: 'advance the durable seed version marker',
      actual: agentSeedVersion,
      expected: 'agent-seed-v6',
    });
  });

  test('points the seeded round at an agent actor, never a user', () => {
    assert({
      given: 'the seeded round author and the agent users',
      should: 'reference one of the seeded actor ids and no user id',
      actual: {
        isActor: agentSeedUsers.some(
          (user) => user.actorId === agentSeedRound.createdByActorId,
        ),
        isUser: agentSeedUsers.some(
          (user) => user.userId === agentSeedRound.createdByActorId,
        ),
        distinctActors: new Set(agentSeedUsers.map((user) => user.actorId))
          .size,
      },
      expected: { isActor: true, isUser: false, distinctActors: 2 },
    });
  });
});
