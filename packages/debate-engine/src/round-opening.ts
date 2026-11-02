import type { ResolutionDrawState } from '@daisy/protocol/resolution-draw';
import { settleDraw, survivorOf, turnOf } from './resolution-draw';

/**
 * A Round's opening: everything between Start round and the countdown. Only
 * the draw's strikes are stored; every other fact derives from these three,
 * so a command, a read and a sweep cannot disagree about where it stands.
 */
export type RoundOpening = {
  /** The Start round instant. */
  readonly startedAt: string;
  readonly draw: ResolutionDrawState | null;
  /** Pre-round prep's full length, or null when the Round has none. */
  readonly prepMs: number | null;
};

export type OpeningStep =
  | {
      readonly step: 'strike';
      readonly turn: NonNullable<ReturnType<typeof turnOf>>;
    }
  | {
      readonly step: 'prep';
      readonly startedAt: string;
      readonly endsAt: string;
    }
  | { readonly step: 'complete'; readonly at: string };

/** Where the opening stands as stored, before any time has been settled. */
export function openingStep(opening: RoundOpening): OpeningStep {
  const { draw, prepMs, startedAt } = opening;
  const turn = draw && turnOf(draw);
  if (turn) return { step: 'strike', turn };
  const anchor = (draw && survivorOf(draw)?.at) ?? startedAt;
  return prepMs === null
    ? { step: 'complete', at: anchor }
    : {
        step: 'prep',
        startedAt: anchor,
        endsAt: new Date(Date.parse(anchor) + prepMs).toISOString(),
      };
}

/**
 * The opening at `now`. Every strike is stamped with its own due instant and
 * completion with the instant prep ended, never the processing time, so a
 * late sweep cannot move the countdown. An automatic side's strike needs the
 * seed; a human time-out does not.
 */
export function settleOpening(
  opening: RoundOpening,
  seed: Uint8Array | null,
  now: string,
): { readonly opening: RoundOpening; readonly step: OpeningStep } {
  const settled = opening.draw
    ? { ...opening, draw: settleDraw(opening.draw, seed, now) }
    : opening;
  const step = openingStep(settled);
  return {
    opening: settled,
    step:
      step.step === 'prep' && Date.parse(now) >= Date.parse(step.endsAt)
        ? { step: 'complete', at: step.endsAt }
        : step,
  };
}
