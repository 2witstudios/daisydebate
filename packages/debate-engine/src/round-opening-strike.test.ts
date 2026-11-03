import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState } from '@daisy/protocol';
import { edges } from './room-assembly.test-support';
import { projectOpening, settleOpening, openingStep } from './round-opening';
import {
  SENTINEL,
  at,
  drawRoom,
  opened,
  seedBytes,
  strike,
} from './round-opening.test-support';

setupRitewayBun();

/** Takes the strikes in order, returning the world each one leaves. */
const struck = (
  world: ReturnType<typeof opened>,
  moves: readonly (readonly [string, number])[],
) =>
  moves.reduce((current, [actor, position], ordinal) => {
    const outcome = strike(current, actor, ordinal, position);
    if (!outcome.ok) throw new Error(outcome.refusal);
    return { ...current, opening: outcome.opening };
  }, world);

describe('strikes', () => {
  test('Negative strikes first, then turns alternate', () => {
    const world = opened();
    const first = strike(world, 'other', 0, 2);
    assert({
      given: 'the affirmative trying the first strike',
      should: 'refuse not-your-turn',
      actual: strike(world, 'host', 0, 0),
      expected: { ok: false, refusal: 'not-your-turn' },
    });
    assert({
      given: 'the negative striking position 2',
      should: 'record a debater strike and leave the draw unrevealed',
      actual:
        first.ok &&
        first.opening.draw!.strikes.map((s) => [
          s.ordinal,
          s.position,
          s.side,
          s.kind,
        ]),
      expected: [[0, 2, 'negative', 'debater']],
    });
  });

  test('stale ordinals conflict, struck positions are unavailable, others are not seated', () => {
    const world = struck(opened(), [['other', 2]]);
    assert({
      given: 'a stale form, an already struck position and a non-debater',
      should: 'refuse strike-conflict, strike-unavailable and not-seated',
      actual: [
        strike(world, 'other', 0, 3),
        strike(world, 'host', 1, 2),
        strike(world, 'watcher', 1, 3),
      ],
      expected: [
        { ok: false, refusal: 'strike-conflict' },
        { ok: false, refusal: 'strike-unavailable' },
        { ok: false, refusal: 'not-seated' },
      ],
    });
  });

  test('the final strike reveals the survivor, and its race loser conflicts', () => {
    const world = struck(opened(), [
      ['other', 0],
      ['host', 1],
      ['other', 2],
      ['host', 3],
    ]);
    const survivor = world.opening.draw!.items.find((i) => i.position === 4)!;
    const read = projectOpening(
      world.opening,
      seedBytes,
      world.seats,
      'watcher',
      edges.now,
    );
    assert({
      given: 'the fourth strike of five, with no prep',
      should: 'make the survivor the topic and complete the opening',
      actual: [read.topic, read.view.step.step],
      expected: [survivor.text, 'complete'],
    });
    assert({
      given: 'a second submission for the same final strike',
      should: 'refuse strike-conflict',
      actual: strike(world, 'host', 3, 4),
      expected: { ok: false, refusal: 'strike-conflict' },
    });
  });

  test('time-outs strike the lowest standing position at their due instant', () => {
    const { opening } = opened();
    const settled = settleOpening(opening, seedBytes, at(125)).opening;
    assert({
      given: 'two full windows passing with no strike',
      should: 'record two time-outs at the deadlines, lowest standing first',
      actual: settled.draw!.strikes.map((s) => [s.position, s.kind, s.at]),
      expected: [
        [0, 'timeout', at(60)],
        [1, 'timeout', at(120)],
      ],
    });
  });

  test('a late strike after the deadline meets the settled turn', () => {
    assert({
      given: 'the negative submitting ordinal 0 exactly at its deadline',
      should: 'refuse strike-conflict: the time-out already took the turn',
      actual: strike(opened(), 'other', 0, 3, at(60)),
      expected: { ok: false, refusal: 'strike-conflict' },
    });
  });

  test('an all-bot side strikes automatically after three seconds', () => {
    const base = drawRoom();
    const withBot: RoomAssemblyState = {
      ...base,
      participants: base.participants.map((p) =>
        p.role === 'negative' ? { ...p, kind: 'bot' } : p,
      ),
    };
    const { opening } = opened(withBot);
    const settled = settleOpening(opening, seedBytes, at(3)).opening;
    assert({
      given: 'a bot Negative and three seconds',
      should: 'record one automatic strike and open the human turn',
      actual: [
        settled.draw!.manifest.controllers,
        settled.draw!.strikes.map((s) => [s.kind, s.at]),
        openingStep(settled).step,
      ],
      expected: [
        { affirmative: 'human', negative: 'automatic' },
        [['automatic', at(3)]],
        'strike',
      ],
    });
  });
});

describe('what each viewer reads of the opening', () => {
  const world = opened();
  const view = (viewer: string | null, source = world) =>
    projectOpening(source.opening, seedBytes, source.seats, viewer, edges.now);

  test('only debaters see drawn texts, and only the turn holder may strike', () => {
    assert({
      given: 'a spectator during the strike',
      should: 'see progress only, with no drawn text anywhere',
      actual: [
        view('watcher').view.draw?.visibility,
        JSON.stringify(view('watcher')).includes(SENTINEL),
        view('watcher').topic,
        view('watcher').view.canStrike,
      ],
      expected: ['progress', false, null, false],
    });
    assert({
      given: 'the Negative, then the Affirmative, on the Negative turn',
      should: 'show both every text and let only the Negative strike',
      actual: ['other', 'host'].map((viewer) => [
        view(viewer).view.draw?.visibility,
        view(viewer).view.canStrike,
      ]),
      expected: [
        ['debater', true],
        ['debater', false],
      ],
    });
  });

  test('struck positions reach debaters only', () => {
    const after = struck(world, [['other', 3]]);
    assert({
      given: 'the Negative struck position 3, read by them and a spectator',
      should: 'show the position to the debater and only the turn to others',
      actual: [
        view('other', after).view.draw?.strikes,
        view('watcher', after).view.draw?.strikes,
      ],
      expected: [
        [
          {
            ordinal: 0,
            side: 'negative',
            kind: 'debater',
            position: 3,
            byViewer: true,
          },
        ],
        [{ ordinal: 0, side: 'negative', kind: 'debater' }],
      ],
    });
  });

  test('prep reports its time left as of the read', () => {
    const prep = opened(drawRoom(), 1_200_000);
    const revealedWorld = struck(prep, [
      ['other', 0],
      ['host', 1],
      ['other', 2],
      ['host', 3],
    ]);
    assert({
      given: 'a revealed draw read one minute into a 20:00 prep',
      should: 'show prep from the reveal with the time left',
      actual: projectOpening(
        revealedWorld.opening,
        seedBytes,
        revealedWorld.seats,
        'watcher',
        at(60),
      ).view.step,
      expected: {
        step: 'prep',
        startedAt: edges.now,
        endsAt: at(1200),
        remainingMs: 1_140_000,
      },
    });
  });
});
