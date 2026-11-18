/**
 * The round bar's slice of the speech order: the live speech, the one after
 * it, and counts for everything else. However many segments a format has
 * (up to 64), the bar draws at most two speech chips; the full order is
 * the Speech order disclosure.
 */
export type SpeechWindow = {
  /** Speeches before the first chip, all done. */
  readonly done: number;
  /** The live speech's index, or null before the first and after the last. */
  readonly live: number | null;
  /** The indexes of the chips after the live one (or the first chips before the round). */
  readonly upcoming: readonly number[];
  /** Speeches after the last chip. */
  readonly remaining: number;
  readonly total: number;
};

/** How many speeches the bar shows after the live one. */
const AHEAD = 1;

const range = (from: number, to: number): readonly number[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

export function speechWindow(total: number, liveIndex: number): SpeechWindow {
  if (liveIndex >= total)
    return { done: total, live: null, upcoming: [], remaining: 0, total };
  if (liveIndex < 0) {
    const shown = Math.min(total, AHEAD + 1);
    return {
      done: 0,
      live: null,
      upcoming: range(0, shown),
      remaining: total - shown,
      total,
    };
  }
  const end = Math.min(total, liveIndex + 1 + AHEAD);
  return {
    done: liveIndex,
    live: liveIndex,
    upcoming: range(liveIndex + 1, end),
    remaining: total - end,
    total,
  };
}

/** Every speech is over: the round is being judged or has ended. */
export const allDone = (strip: SpeechWindow): boolean =>
  strip.total > 0 && strip.done === strip.total;

/** "3 of 7" while a speech is on, else the round's length or that it is over. */
export function speechPosition(strip: SpeechWindow): string {
  if (strip.live !== null) return `${strip.live + 1} of ${strip.total}`;
  if (allDone(strip)) return 'All done';
  return `${strip.total} ${strip.total === 1 ? 'speech' : 'speeches'}`;
}
