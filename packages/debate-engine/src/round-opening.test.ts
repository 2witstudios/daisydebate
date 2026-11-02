import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ResolutionDrawState } from '@daisy/protocol/resolution-draw';
import { openingStep, settleOpening, type RoundOpening } from './round-opening';
import { begin } from './round-opening.test-support';

setupRitewayBun();

const STARTED_AT = '2026-11-02T12:00:00.000Z';
const PREP_MS = 20 * 60_000;
const after = (ms: number, from = STARTED_AT) =>
  new Date(Date.parse(from) + ms).toISOString();

const humanDraw = (): ResolutionDrawState => ({
  ...begin().draw!.state,
  startedAt: STARTED_AT,
  strikes: [],
});
const windowMs = (draw: ResolutionDrawState) => draw.manifest.strikeWindowMs;
const opening = (
  draw: ResolutionDrawState | null,
  prepMs: number | null,
): RoundOpening => ({ startedAt: STARTED_AT, draw, prepMs });

describe('openingStep', () => {
  test('a Round with neither step opens at Start round', () => {
    assert({
      given: 'no draw and no prep',
      should: 'be complete at the Start round instant',
      actual: openingStep(opening(null, null)),
      expected: { step: 'complete', at: STARTED_AT },
    });
  });

  test('prep with no draw runs from Start round', () => {
    assert({
      given: 'prep and no draw',
      should: 'prep from Start round for its full length',
      actual: openingStep(opening(null, PREP_MS)),
      expected: {
        step: 'prep',
        startedAt: STARTED_AT,
        endsAt: after(PREP_MS),
      },
    });
  });

  test('an unrevealed draw is the strike step whatever prep follows', () => {
    const step = openingStep(opening(humanDraw(), PREP_MS));
    assert({
      given: 'a draw with no strikes yet',
      should: 'be on the first strike turn',
      actual: step.step === 'strike' ? step.turn.ordinal : step.step,
      expected: 0,
    });
  });
});

describe('settleOpening', () => {
  test('time-outs settle to the reveal, then prep anchors at the reveal', () => {
    const draw = humanDraw();
    const strikes = draw.manifest.drawSize - 1;
    const revealAt = after(windowMs(draw) * strikes);
    const settled = settleOpening(
      opening(draw, PREP_MS),
      null,
      after(1, revealAt),
    );
    assert({
      given: 'every human strike window expired, with prep to follow',
      should: 'stamp each strike at its own due instant',
      actual: settled.opening.draw!.strikes.map((s) => [s.at, s.kind]),
      expected: Array.from({ length: strikes }, (_, i) => [
        after(windowMs(draw) * (i + 1)),
        'timeout',
      ]),
    });
    assert({
      given: 'the same settlement',
      should: 'anchor prep at the reveal, never at the processing time',
      actual: settled.step,
      expected: {
        step: 'prep',
        startedAt: revealAt,
        endsAt: after(PREP_MS, revealAt),
      },
    });
  });

  test('prep ends only when its full length has run', () => {
    const start = opening(null, PREP_MS);
    assert({
      given: 'the last millisecond of prep',
      should: 'still be prepping',
      actual: settleOpening(start, null, after(PREP_MS - 1)).step.step,
      expected: 'prep',
    });
    assert({
      given: 'a sweep running long after prep ended',
      should: 'complete at the prep end, so the countdown cannot drift',
      actual: settleOpening(start, null, after(PREP_MS + 90_000)).step,
      expected: { step: 'complete', at: after(PREP_MS) },
    });
  });

  test('a draw with no prep completes at the reveal', () => {
    const draw = humanDraw();
    const revealAt = after(windowMs(draw) * (draw.manifest.drawSize - 1));
    assert({
      given: 'a revealed draw and no prep',
      should: 'complete at the reveal instant',
      actual: settleOpening(opening(draw, null), null, after(5, revealAt)).step,
      expected: { step: 'complete', at: revealAt },
    });
  });

  test('settling again at the same instant changes nothing', () => {
    const draw = humanDraw();
    const now = after(windowMs(draw) + 1);
    const once = settleOpening(opening(draw, PREP_MS), null, now);
    assert({
      given: 'an already settled opening',
      should: 'settle to the same strikes',
      actual: settleOpening(once.opening, null, now).opening.draw!.strikes,
      expected: once.opening.draw!.strikes,
    });
  });
});
