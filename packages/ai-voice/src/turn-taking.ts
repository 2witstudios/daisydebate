/**
 * Cross-examination turn-taking from the levels of a peer's microphone as
 * the server hears it: a pure state machine fed one sample per audio frame.
 * It reports when the peer starts speaking, when their turn ends (a pause
 * long enough after speech) and when they talk over the bot.
 *
 * Speech is not a steady level: it dips between syllables. A level counts as
 * held through a dip shorter than `dipMs`, so a dip inside a word neither
 * ends a barge-in nor starts a pause, while a single click, which nothing
 * follows, is over before it can count as speech.
 *
 * A sample may be unheard (`level: null`): no fresh audio arrived. That is
 * neither speech nor silence. It never starts speech or a barge-in, and it
 * keeps a turn in progress; a peer unheard for the whole end-of-turn pause
 * has ended their turn as far as anyone can hear.
 */
export type TurnTakingSettings = {
  /** Frame level (RMS, 0..1) that counts as speech. */
  readonly speechLevel: number;
  /** Speech must last this long before it counts. */
  readonly minSpeechMs: number;
  /** A pause this long after speech ends the peer's turn. */
  readonly endOfTurnMs: number;
  /** While the bot plays, the level that counts as talking over it. */
  readonly bargeLevel: number;
  /** ...held for this long. */
  readonly bargeMs: number;
  /** A dip below a level shorter than this does not break it. */
  readonly dipMs: number;
};

/**
 * For the echo-cancelled track the server subscribes to. The barge-in level
 * sits above the speech level because a trace of the bot's own voice can
 * come back through the peer's microphone.
 */
export const turnTakingSettings: TurnTakingSettings = {
  speechLevel: 0.015,
  minSpeechMs: 150,
  endOfTurnMs: 900,
  bargeLevel: 0.035,
  bargeMs: 200,
  dipMs: 80,
};

export type TurnTakingEvent =
  | { readonly kind: 'speech-start' }
  | { readonly kind: 'barge-in' }
  /** `spokeUntil` is the instant of the last frame at speech level. */
  | { readonly kind: 'end-of-turn'; readonly spokeUntil: number };

export function createTurnTaking(settings: TurnTakingSettings) {
  let speaking = false;
  /** The last frames at each level; a level holds for `dipMs` past them. */
  let speechAt = -Infinity;
  let bargeAt = -Infinity;
  let aboveSince: number | null = null;
  let quietSince: number | null = null;
  let bargeSince: number | null = null;
  /** One barge-in per stretch of talking over: armed again once it stops. */
  let barged = false;
  let spokeUntil = 0;
  const endTurn = (): TurnTakingEvent => {
    speaking = false;
    aboveSince = null;
    quietSince = null;
    return { kind: 'end-of-turn', spokeUntil };
  };
  /** Time without speech counts toward the end of a turn in progress. */
  const pause = (at: number): TurnTakingEvent | null => {
    if (!speaking) return null;
    quietSince ??= at;
    return at - quietSince >= settings.endOfTurnMs ? endTurn() : null;
  };
  const unheard = (at: number): TurnTakingEvent | null => {
    speechAt = -Infinity;
    bargeAt = -Infinity;
    aboveSince = null;
    bargeSince = null;
    barged = false;
    return pause(at);
  };
  /** While the bot plays: only a voice above its own echo, sustained, counts. */
  const whilePlaying = (at: number): TurnTakingEvent | null => {
    aboveSince = null;
    if (at - bargeAt > settings.dipMs) {
      bargeSince = null;
      barged = false;
      // Below speech level is quiet for certain; between the two levels may
      // be the bot's echo, which neither continues nor ends a turn.
      return at - speechAt > settings.dipMs ? pause(at) : null;
    }
    quietSince = null;
    bargeSince ??= at;
    if (barged || at - bargeSince < settings.bargeMs) return null;
    barged = true;
    // A peer already mid-turn is still talking over the bot.
    speaking = true;
    return { kind: 'barge-in' };
  };
  const whileListening = (at: number): TurnTakingEvent | null => {
    bargeSince = null;
    barged = false;
    if (at - speechAt > settings.dipMs) {
      aboveSince = null;
      return pause(at);
    }
    quietSince = null;
    if (speaking) return null;
    aboveSince ??= at;
    if (at - aboveSince < settings.minSpeechMs) return null;
    speaking = true;
    aboveSince = null;
    return { kind: 'speech-start' };
  };
  return {
    /** One sample at instant `at` (ms); returns the event it completes, if any. */
    feed({
      at,
      level,
      aiPlaying,
    }: {
      readonly at: number;
      /** The frame's RMS level, or null when no fresh audio arrived. */
      readonly level: number | null;
      readonly aiPlaying: boolean;
    }): TurnTakingEvent | null {
      if (level === null) return unheard(at);
      if (level >= settings.speechLevel) {
        speechAt = at;
        spokeUntil = at;
      }
      if (level >= settings.bargeLevel) bargeAt = at;
      return aiPlaying ? whilePlaying(at) : whileListening(at);
    },
    /** Whether the peer is mid-turn: speech started and its turn has not ended. */
    speaking: () => speaking,
  };
}
