/**
 * Cross-examination turn-taking from microphone levels: a pure state
 * machine the browser feeds every few tens of milliseconds. It reports when
 * the person starts speaking, when their turn ends (a pause long enough
 * after speech), and when they barge in over the AI. While the AI plays,
 * its own voice can leak into the microphone despite echo cancellation, so
 * a barge-in needs a higher level held for longer.
 */
export type TurnTakingSettings = {
  /** RMS level (0..1) that counts as speech. */
  readonly speechLevel: number;
  /** Speech must last this long before it counts. */
  readonly minSpeechMs: number;
  /** A pause this long after speech ends the person's turn. */
  readonly endOfTurnMs: number;
  /** While the AI plays, the level that counts as an interruption. */
  readonly bargeLevel: number;
  /** ...held for this long. */
  readonly bargeMs: number;
};

export const defaultTurnTakingSettings: TurnTakingSettings = {
  speechLevel: 0.02,
  minSpeechMs: 150,
  endOfTurnMs: 900,
  bargeLevel: 0.12,
  bargeMs: 300,
};

export type TurnTakingEvent = 'speech-start' | 'end-of-turn' | 'barge-in';

export function createTurnTaking(settings: TurnTakingSettings) {
  let speaking = false;
  let aboveSince: number | null = null;
  let quietSince: number | null = null;
  let bargeSince: number | null = null;
  const reset = () => {
    speaking = false;
    aboveSince = null;
    quietSince = null;
    bargeSince = null;
  };
  /** While the AI plays: only a loud, sustained voice counts. */
  const whilePlaying = (at: number, level: number): TurnTakingEvent | null => {
    if (level < settings.bargeLevel) {
      bargeSince = null;
      return null;
    }
    bargeSince ??= at;
    if (at - bargeSince < settings.bargeMs) return null;
    reset();
    speaking = true;
    return 'barge-in';
  };
  const whileSpeaking = (at: number): TurnTakingEvent | null => {
    aboveSince = null;
    if (!speaking) return null;
    quietSince ??= at;
    if (at - quietSince < settings.endOfTurnMs) return null;
    reset();
    return 'end-of-turn';
  };
  const whileListening = (at: number): TurnTakingEvent | null => {
    quietSince = null;
    if (speaking) return null;
    aboveSince ??= at;
    if (at - aboveSince < settings.minSpeechMs) return null;
    speaking = true;
    aboveSince = null;
    return 'speech-start';
  };
  return {
    /** One level sample; returns the event it completes, if any. */
    feed({
      at,
      level,
      aiPlaying,
    }: {
      readonly at: number;
      readonly level: number;
      readonly aiPlaying: boolean;
    }): TurnTakingEvent | null {
      if (aiPlaying) return whilePlaying(at, level);
      bargeSince = null;
      return level >= settings.speechLevel
        ? whileListening(at)
        : whileSpeaking(at);
    },
    /** Forget any speech in progress (a new turn begins). */
    reset,
  };
}
