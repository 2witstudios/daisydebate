import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { setup } from './operations.test-support';

setupRitewayBun();

describe('start and view', () => {
  test('a person starts a practice round and only they can see it', async () => {
    const { operations, begin } = setup();
    const id = await begin();
    const view = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: 'a new practice round with untidy spacing in the resolution',
      should: 'store the tidied resolution as a scheduled round',
      actual: {
        resolution: view.resolution,
        status: view.status,
        segments: view.rules.segments.length,
      },
      expected: {
        resolution: 'Social media does more harm than good',
        status: 'active',
        segments: 7,
      },
    });
    await assertRejects({
      given: 'another actor asking for it',
      should: 'answer NOT_FOUND',
      actual: () => operations.view({ actorId: 'actor-2', id }),
      code: 'NOT_FOUND',
    });
  });

  test('refuses an unknown opponent and a short resolution', async () => {
    const { operations } = setup();
    await assertRejects({
      given: 'an opponent no Train bot is',
      should: 'refuse with VALIDATION',
      actual: () =>
        operations.start({
          actorId: 'a',
          resolution: 'Resolved: x y',
          personSide: 'negative',
          opponent: 'robot',
        }),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'a resolution of two characters',
      should: 'refuse with VALIDATION',
      actual: () =>
        operations.start({
          actorId: 'a',
          resolution: 'ok',
          personSide: 'negative',
          opponent: 'wren',
        }),
      code: 'VALIDATION',
    });
  });

  test('refuses the fourth debate in a day under a three-a-day limit', async () => {
    const { operations } = setup({ live: 25, perDay: 3 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await operations.start({
        actorId: 'actor-1',
        resolution: 'Resolved: practice makes patterns',
        personSide: 'affirmative',
        opponent: 'wren',
      });
    }
    await assertRejects({
      given: 'a fourth start inside the window',
      should: 'refuse with RATE_LIMIT',
      actual: () =>
        operations.start({
          actorId: 'actor-1',
          resolution: 'Resolved: practice makes patterns',
          personSide: 'affirmative',
          opponent: 'wren',
        }),
      code: 'RATE_LIMIT',
    });
  });
});

describe('commands and the ballot', () => {
  test('a refused command changes nothing', async () => {
    const { operations, begin, clock } = setup();
    const id = await begin();
    clock.advance(11); // the AC opens
    await assertRejects({
      given: 'a startSpeech while the AC is live',
      should: 'refuse with the prep invariant',
      actual: () =>
        operations.command({
          actorId: 'actor-1',
          id,
          command: { type: 'startSpeech' },
          expectedVersion: 2,
        }),
      code: 'INVARIANT',
      invariantId: 'round.speech.requires-prep',
    });
    assert({
      given: 'the refused command',
      should: "leave the round at the tick's applied version, unwritten by it",
      actual: (await operations.view({ actorId: 'actor-1', id })).version,
      expected: 3,
    });
  });

  test('judges once after the last segment and completes the round', async () => {
    const { operations, begin, clock, calls } = setup();
    const id = await begin();
    await assertRejects({
      given: 'a ballot request mid-debate',
      should: 'refuse with CONFLICT',
      actual: () => operations.ballot({ actorId: 'actor-1', id }),
      code: 'CONFLICT',
    });
    clock.advance(3 * 3600);
    const first = await operations.ballot({ actorId: 'actor-1', id });
    const second = await operations.ballot({ actorId: 'actor-1', id });
    assert({
      given: 'two ballot requests after the round is spoken out',
      should:
        'judge once, return the same ballot and complete the round with the outcome',
      actual: {
        winner: [first.winner, second.winner],
        judgeCalls: calls.filter((call) => call === 'complete').length,
        status: (await operations.view({ actorId: 'actor-1', id })).status,
      },
      expected: {
        winner: ['affirmative', 'affirmative'],
        judgeCalls: 1,
        status: 'completed',
      },
    });
  });

  test("prep precedes the person's own speeches when they ask for it", async () => {
    const { operations, begin, clock } = setup();
    const id = await begin();
    clock.advance(11); // AC opens and runs
    clock.advance(300); // AC closes by time; CX1's countdown runs
    clock.advance(130); // CX1 opens and closes; NC's countdown runs
    clock.advance(370); // NC opens and closes
    clock.advance(130); // CX2 opens and closes; 1AR's countdown runs
    const view = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: "the gap before the person's own rebuttal",
      should: 'hold the next segment open for prep, at its budget',
      actual: {
        next: view.rules.segments[4]?.key,
        budget: view.rules.inRoundPrep?.budgetMsPerSide,
      },
      expected: { next: '1AR', budget: 240_000 },
    });
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'startPrep' },
      expectedVersion: view.version,
    });
    clock.advance(60);
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'startSpeech' },
      expectedVersion: (await operations.view({ actorId: 'actor-1', id }))
        .version,
    });
    const after = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: 'start_speech a minute into prep',
      should: 'open the segment with the elapsed prep folded',
      actual: after.checkpoint.prep_consumed_ms,
      expected: { affirmative: 60_000, negative: 0 },
    });
  });
});
