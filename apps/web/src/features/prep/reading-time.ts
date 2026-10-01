/** Words in a text: runs of non-space characters. */
export const wordCount = (text: string): number =>
  text.trim() === '' ? 0 : text.trim().split(/\s+/).length;

/** Whole seconds to read `words` aloud at `wpm` words a minute. */
export const readSeconds = (words: number, wpm: number): number =>
  wpm > 0 ? Math.round((words / wpm) * 60) : 0;

/** Seconds as m:ss. */
export const formatClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** How a time compares with a limit the debate rules supply. */
export type Budget = {
  readonly over: boolean;
  readonly deltaSeconds: number;
  /** Bar fill, 0 to 100. */
  readonly percent: number;
};

export function budget(readSecs: number, limitSecs: number): Budget {
  return {
    over: readSecs > limitSecs,
    deltaSeconds: Math.abs(readSecs - limitSecs),
    percent:
      limitSecs > 0
        ? Math.min(100, Math.round((readSecs / limitSecs) * 100))
        : 0,
  };
}

/** Words to cut so `overSeconds` of extra time fits, at `wpm`. */
export const trimWords = (overSeconds: number, wpm: number): number =>
  Math.ceil((overSeconds / 60) * wpm);
