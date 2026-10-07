import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  practiceCast,
  practiceSeats,
  runtimeWorld as runtime,
} from './runtime.test-support';

setupRitewayBun();

const { rules, at, person, opponent } = practiceCast();

describe('round runtime command refusals and seat order', () => {
  test('a scheduled round refuses in-round prep without changing its checkpoint', async () => {
    const world = runtime();
    const before = world.checkpoint();
    await assertRejects({
      given:
        'a seated debater asking for in-round prep before the round starts',
      should: 'refuse with a conflict',
      actual: () =>
        world.execute({
          command: { type: 'start_prep' },
          actorId: person,
          now: at(0),
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused premature prep',
      should: 'preserve the scheduled checkpoint',
      actual: world.checkpoint(),
      expected: before,
    });
  });

  test('refuses the app-error paths: a started round and a seatless interrupt', async () => {
    const started = runtime({ status: 'active' });
    await assertRejects({
      given: 'a start command against an already active round',
      should: 'refuse with a conflict, not an invariant',
      actual: () =>
        started.execute({
          command: { type: 'start' },
          actorId: null,
          now: at(0),
        }),
      code: 'CONFLICT',
    });
    // CX1 is live at 325_000: cross-examination, 115_000 remaining.
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    world.tick(at(320_000));
    await assertRejects({
      given: 'an interrupt from no seat at all',
      should: 'refuse with a conflict',
      actual: () =>
        world.execute({
          command: { type: 'interrupt' },
          actorId: null,
          now: at(325_000),
        }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'the judge asking to take the debaters’ floor',
      should: 'refuse even though the judge holds a seat',
      actual: () =>
        world.execute({
          command: { type: 'interrupt' },
          actorId: practiceSeats[2].actorId,
          now: at(325_000),
        }),
      code: 'CONFLICT',
    });
  });

  test('refuses prep once no segment remains to spend it before', async () => {
    // Every segment closed while the round is still active: no open row, no
    // segment left to spend prep before.
    const spent = runtime({
      status: 'active',
      segments: rules.segments.map((segment, index) => ({
        id: `spent-${index + 1}`,
        sequence: index,
        type: segment.type,
        rulesSegmentKey: segment.key,
        startedAt: at(index),
        endedAt: at(index + 1),
        durationMs: segment.durationMs,
      })),
    });
    await assertRejects({
      given: 'a prep command after the whole schedule has spoken',
      should: 'refuse with the spendable-segment invariant',
      actual: () =>
        spent.execute({
          command: { type: 'start_prep' },
          actorId: person,
          now: at(1_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.prep.requires-spendable-segment',
    });
    assert({
      given: 'the final speech was yielded early and every segment is closed',
      should: 'offer the terminal round to its judge',
      actual: spent.position(at(1_000)).awaitingBallot,
      expected: true,
    });
    const completed = spent.execute({
      command: { type: 'complete', outcome: 'affirmative' },
      actorId: practiceSeats[2].actorId,
      now: at(1_000),
    });
    assert({
      given: 'a judge ruling after the final speech yielded early',
      should: 'complete that same round',
      actual: completed.round?.status,
      expected: 'completed',
    });
  });

  test('refuses prep whose budget died at an already-reached segment', async () => {
    const world = runtime({
      status: 'active',
      rules: {
        ...rules,
        inRoundPrep: {
          ...rules.inRoundPrep!,
          expiresAtSegment: 'AC',
        },
      },
    });
    world.tick(at(310_000)); // AC closed by time; CX1's countdown runs
    await assertRejects({
      given: 'prep whose expiry segment has already closed',
      should: 'refuse with the spendable-segment invariant',
      actual: () =>
        world.execute({
          command: { type: 'start_prep' },
          actorId: person,
          now: at(315_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.prep.requires-spendable-segment',
    });
  });

  test('refuses a yield with no live segment and a yield the rules forbid', async () => {
    const idle = runtime({ status: 'active' });
    await assertRejects({
      given: 'a yield while no segment is open',
      should: 'refuse with the yield-requires-floor invariant',
      actual: () =>
        idle.execute({
          command: { type: 'yield' },
          actorId: person,
          now: at(1_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
    const forbidden = runtime({
      status: 'active',
      rules: {
        ...rules,
        interaction: { ...rules.interaction, yield: null },
      },
    });
    await assertRejects({
      given: 'a yield the resolved rules forbid outright',
      should: 'refuse with the yield-requires-floor invariant',
      actual: () =>
        forbidden.execute({
          command: { type: 'yield' },
          actorId: person,
          now: at(1_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
  });

  test('starts a round whose role holds several seats, in the order they arrived', async () => {
    const second = {
      id: 'n9q4w8e2r6t0y3u7i5o1p9a3s7d',
      actorId: opponent,
      role: 'negative',
      slot: 1,
    } as const;
    // The second negative seat arrives before the first: the completeness
    // check sorts the held slots before comparing them.
    const world = runtime({
      participants: [
        practiceSeats[0],
        second,
        practiceSeats[1],
        practiceSeats[2],
      ],
      rules: {
        ...rules,
        seats: { affirmative: 1, negative: 2, judge: 1 },
      },
    });
    const projection = world.execute({
      command: { type: 'start' },
      actorId: null,
      now: at(0),
    });
    assert({
      given: 'a round whose negative role holds two seats, out of order',
      should: 'start once the held slots are exactly 0..1',
      actual: projection.round?.status,
      expected: 'active',
    });
  });
});
