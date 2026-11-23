import { spokenPrefix } from '@daisy/protocol/authored-speech';
import {
  emptyLineLedger,
  lineCredit,
  lineCutAt,
  lineRevealed,
  nextLineLedger,
  playedFraction,
  type LineEvent,
} from './line-ledger';
import {
  emptyPublicationSchedule,
  nextPublicationSchedule,
  type ScheduleEvent,
} from './publication-schedule';

/**
 * A claim's publisher as one pure step (R4.3, ADR 0122): its state and one
 * event in, the next state and the effects to perform out. It decides what
 * is authorized and when, what starts, what is cut and where, what each
 * line is credited, when audio must stop, which calls are asked again and
 * how often, and how the claim drains. The shell performs the effects and
 * reports each result as the next event.
 */

/** The audio track as an event is read: the time, its queue and its health. */
export type TrackFacts = {
  readonly nowMs: number;
  readonly queuedMs: number;
  readonly usable: boolean;
};
/** A failed call, as the shell classified it. */
export type Failure = {
  readonly error: unknown;
  /** A lost reply or a timeout: worth asking again. A refusal is an answer. */
  readonly transient: boolean;
  /** Refused for a retired room: the next join takes the fresh one (ADR 0110). */
  readonly roomChanged: boolean;
};
/** A phrase as the publisher decides on it; the shell holds its audio. */
export type PhraseFacts = {
  readonly id: string;
  readonly text: string;
  /** Its audio in whole 10 ms frames. */
  readonly durationMs: number;
  /** Its own samples, without the padding of its last frame. */
  readonly samples: number;
};
/** How the audio writer ended (`@daisy/media/publication`). */
export type Written = {
  readonly sentSamples: number;
  readonly playedSamples: number;
  readonly aborted: boolean;
  readonly cut: boolean;
  readonly failure?: unknown;
};
/** How a published phrase ended: played whole, cut at the segment end, or stopped. */
export type PhraseOutcome = {
  readonly complete: boolean;
  /** It reached the speech's hard stop: the segment is over for this bot. */
  readonly segmentEnded: boolean;
};
export type LineEnd =
  | { readonly kind: 'whole' }
  | {
      readonly kind: 'cut';
      readonly spoken: string;
      readonly playedMs: number;
    };
/** A store call; instants are on the database clock. */
export type CallArgs =
  | {
      readonly kind: 'authorize';
      readonly phrase: PhraseFacts;
      readonly startsInMs: number;
      readonly startsAtMs: number | null;
      readonly room: string;
    }
  | {
      readonly kind: 'reveal';
      readonly phrase: PhraseFacts;
      readonly room: string;
      readonly startedAtMs: number | null;
    }
  | { readonly kind: 'end'; readonly phraseId: string; readonly end: LineEnd };
type Call = {
  readonly id: number;
  readonly args: CallArgs;
  readonly attempt: number;
  readonly last: Failure | null;
};
/** An authorization: held for a phrase asked ahead, for the phrase in play, or by nobody. */
type Ask = {
  readonly phraseId: string;
  readonly call: number;
  readonly holder: 'ahead' | 'play' | 'none';
  readonly outcome: 'pending' | 'granted' | Failure;
};
type Track =
  | { readonly status: 'none' | 'left' }
  | { readonly status: 'joining' | 'joined'; readonly join: number };
type Answer =
  | { readonly kind: 'outcome'; readonly outcome: PhraseOutcome }
  | { readonly kind: 'error'; readonly error: unknown };
type Stage =
  /** `early` waits on the join begun ahead of speech; `replace` follows an unusable one. */
  | { readonly name: 'joining'; readonly using: 'early' | 'fresh' | 'replace' }
  /** `fresh` once asked at play rather than ahead. */
  | { readonly name: 'authorizing'; readonly fresh: boolean }
  | { readonly name: 'writing' }
  | { readonly name: 'revealing'; readonly written: Written }
  /** Waiting for its line's end before answering. */
  | { readonly name: 'ending'; readonly call: number; readonly answer: Answer };
type Playing = {
  readonly phrase: PhraseFacts;
  readonly stopAtMs: number;
  readonly stopped: boolean;
  readonly refusal: Failure | null;
  readonly stage: Stage;
  readonly audioStartsAtMs: number;
  readonly reveal: 'waiting' | 'asking' | 'settled' | 'skipped';
  readonly floor: 'waiting' | 'reading' | 'off';
  /** The writer dropped its queue: audio not yet started never plays. */
  readonly silenced: boolean;
  readonly playsUntilMs: number;
};
/** A played phrase's line, closed in order once its queued tail has played. */
type Closing = {
  readonly phrase: PhraseFacts;
  readonly playsUntilMs: number;
  readonly status: 'queued' | 'waiting' | { readonly call: number };
};
export type PublisherState = {
  readonly claim: 'open' | 'draining' | 'leaving' | 'closed';
  /** Ends asked again that the claim's end waits for; `last` once asked a final time. */
  readonly drain: 'closes' | 'retries' | 'last' | null;
  readonly track: Track;
  readonly room: string | null;
  readonly roomLeft: boolean;
  /** The database clock less the monotonic one, read with the speech's deadline. */
  readonly dbOffsetMs: number | null;
  readonly lines: ReturnType<typeof emptyLineLedger>;
  readonly schedule: ReturnType<typeof emptyPublicationSchedule>;
  /** Phrases written ahead, waiting for the schedule to authorize them. */
  readonly ahead: readonly PhraseFacts[];
  readonly asks: readonly Ask[];
  readonly calls: readonly Call[];
  /** Each line's end as last asked, so a passing failure is asked again the same. */
  readonly ends: readonly {
    readonly phraseId: string;
    readonly end: LineEnd;
  }[];
  readonly playing: Playing | null;
  readonly closes: readonly Closing[];
  readonly retrying: readonly number[];
  readonly sequence: number;
};
export type Wait =
  | { readonly kind: 'retry'; readonly call: number }
  | {
      readonly kind: 'audio-start' | 'floor' | 'tail';
      readonly phraseId: string;
    };
export type PublisherEvent = { readonly facts: TrackFacts } & (
  | {
      readonly type:
        'start' | 'stop' | 'silence' | 'discard' | 'close' | 'resumed';
    }
  | {
      readonly type: 'clock-read';
      readonly sentAtMs: number;
      readonly serverNowMs: number;
      readonly segmentDueAtMs: number;
    }
  | {
      readonly type: 'publish';
      readonly phrase: PhraseFacts;
      readonly stopAtMs: number;
      readonly stopped: boolean;
    }
  | { readonly type: 'write-ahead'; readonly phrase: PhraseFacts }
  | {
      readonly type: 'joined';
      readonly join: number;
      readonly room: string;
      readonly usable: boolean;
    }
  | { readonly type: 'join-failed'; readonly join: number }
  | { readonly type: 'left'; readonly join: number }
  | { readonly type: 'answered'; readonly call: number }
  | {
      readonly type: 'refused';
      readonly call: number;
      readonly failure: Failure;
    }
  | { readonly type: 'woke'; readonly wait: Wait }
  | {
      readonly type: 'floor-read';
      readonly phraseId: string;
      readonly failure: Failure | null;
    }
  | { readonly type: 'written'; readonly written: Written }
);
export type PublisherEffect =
  | { readonly type: 'join' | 'leave'; readonly join: number }
  | { readonly type: 'call'; readonly call: number; readonly args: CallArgs }
  | {
      readonly type: 'watch-floor';
      readonly phraseId: string;
      readonly room: string;
    }
  | { readonly type: 'write'; readonly stopAtMs: number }
  | { readonly type: 'stop-writing' | 'clear-queue' | 'closed' }
  /**
   * Hands control back before going on: a track or an authorization already
   * in hand is still taken asynchronously, so what the speaker asks right
   * after a publish (the next phrase ahead) lands first.
   */
  | { readonly type: 'resume' }
  | { readonly type: 'deadline'; readonly atMs: number }
  | { readonly type: 'wait'; readonly wait: Wait; readonly untilMs: number }
  | { readonly type: 'cancel'; readonly wait: Wait }
  | ({ readonly type: 'answer' } & Answer);

/** The refusal a publish answers when it was stopped or cannot go on. */
export const STOPPED = Symbol('stopped');
/** Attempts at a call that failed for a reason a retry may clear. */
const ATTEMPTS = 3;
const RETRY_MS = 100;
/** How often a playing phrase re-reads its floor beside its audio. */
const FLOOR_WATCH_MS = 250;

export const emptyPublisher = (): PublisherState => ({
  claim: 'open',
  drain: null,
  track: { status: 'none' },
  room: null,
  roomLeft: false,
  dbOffsetMs: null,
  lines: emptyLineLedger(),
  schedule: emptyPublicationSchedule(),
  ahead: [],
  asks: [],
  calls: [],
  ends: [],
  playing: null,
  closes: [],
  retrying: [],
  sequence: 0,
});

/** One step's working copy: the state so far, the effects so far, the track now. */
type Step = {
  state: PublisherState;
  readonly effects: PublisherEffect[];
  readonly facts: TrackFacts;
  queuedMs: number;
};

export function stepPublisher(
  state: PublisherState,
  event: PublisherEvent,
): {
  readonly state: PublisherState;
  readonly effects: readonly PublisherEffect[];
} {
  const step: Step = {
    state,
    effects: [],
    facts: event.facts,
    queuedMs: Math.max(0, event.facts.queuedMs),
  };
  handle(step, event);
  return { state: step.state, effects: step.effects };
}

const set = (step: Step, change: Partial<PublisherState>) => {
  step.state = { ...step.state, ...change };
};
const emit = (step: Step, effect: PublisherEffect) => {
  step.effects.push(effect);
};
const now = (step: Step) => step.facts.nowMs;
const record = (step: Step, event: LineEvent) => {
  const next = nextLineLedger(step.state.lines, event);
  set(step, { lines: next.state });
  return next.effects;
};
const play = (step: Step, change: Partial<Playing>) => {
  const { playing } = step.state;
  if (playing) set(step, { playing: { ...playing, ...change } });
};
const sequence = (step: Step) => {
  set(step, { sequence: step.state.sequence + 1 });
  return step.state.sequence;
};
const noteRoom = (step: Step, failure: Failure) =>
  set(step, { roomLeft: failure.roomChanged });

function handle(step: Step, event: PublisherEvent) {
  switch (event.type) {
    case 'start':
      if (step.state.track.status === 'none') join(step);
      return;
    case 'clock-read': {
      const dbOffsetMs = event.serverNowMs - event.sentAtMs;
      set(step, { dbOffsetMs });
      return emit(step, {
        type: 'deadline',
        atMs: event.segmentDueAtMs - dbOffsetMs,
      });
    }
    case 'write-ahead':
      set(step, {
        ahead: [
          ...step.state.ahead.filter(({ id }) => id !== event.phrase.id),
          event.phrase,
        ],
      });
      return plan(step, {
        type: 'prepare',
        phraseId: event.phrase.id,
        joined: step.state.room !== null,
        nowMs: now(step),
      });
    case 'silence':
      return clearNow(step, false);
    case 'discard':
      return discard(step);
    case 'publish':
      return publish(step, event);
    case 'stop':
      return stop(step);
    case 'close':
      return close(step);
    case 'resumed':
      return resumed(step);
    case 'joined':
    case 'join-failed':
      return joinSettled(step, event);
    case 'left':
      return left(step);
    case 'answered':
    case 'refused':
      return callSettled(step, event);
    case 'woke':
      return woke(step, event.wait);
    case 'floor-read':
      return floorRead(step, event.phraseId, event.failure);
    case 'written':
      return written(step, event.written);
  }
}

const join = (step: Step) => {
  const id = sequence(step);
  set(step, { track: { status: 'joining', join: id } });
  emit(step, { type: 'join', join: id });
};

/** Forgets phrases authorized ahead: nothing was written for them. */
const discard = (step: Step) => {
  plan(step, { type: 'discard' });
  set(step, {
    ahead: [],
    asks: step.state.asks.map((entry) =>
      entry.holder === 'ahead' ? { ...entry, holder: 'none' } : entry,
    ),
  });
};
/** Silences what is queued at once, recording the clear, and forgets what was asked ahead. */
const clearNow = (step: Step, forgetAhead: boolean) => {
  if (step.queuedMs > 0) {
    record(step, { type: 'clear', atMs: now(step) });
    emit(step, { type: 'clear-queue' });
    step.queuedMs = 0;
  }
  if (forgetAhead) discard(step);
};
const plan = (step: Step, event: ScheduleEvent) => {
  const next = nextPublicationSchedule(step.state.schedule, event);
  set(step, { schedule: next.state });
  for (const effect of next.effects) {
    const phrase = step.state.ahead.find(({ id }) => id === effect.phraseId);
    set(step, {
      ahead: step.state.ahead.filter(({ id }) => id !== effect.phraseId),
    });
    if (phrase && step.state.room !== null)
      authorize(step, phrase, effect.startsInMs, 'ahead');
  }
};
const scheduledNow = (step: Step) =>
  plan(step, { type: 'scheduled', endsAtMs: now(step), nowMs: now(step) });

/** Starts a call; a passing failure asks it again, up to `ATTEMPTS`. */
const call = (step: Step, args: CallArgs) => {
  const id = sequence(step);
  set(step, {
    calls: [...step.state.calls, { id, args, attempt: 1, last: null }],
  });
  emit(step, { type: 'call', call: id, args });
  return id;
};
/** Dated on the database clock as it is asked, never by its commit. */
const dbInstant = (step: Step, monotonicMs: number) =>
  step.state.dbOffsetMs === null ? null : monotonicMs + step.state.dbOffsetMs;
const authorize = (
  step: Step,
  phrase: PhraseFacts,
  startsInMs: number,
  holder: Ask['holder'],
) => {
  const id = call(step, {
    kind: 'authorize',
    phrase,
    startsInMs,
    startsAtMs: dbInstant(step, now(step) + startsInMs),
    room: step.state.room ?? '',
  });
  set(step, {
    asks: [
      ...step.state.asks,
      { phraseId: phrase.id, call: id, holder, outcome: 'pending' },
    ],
  });
};

function publish(
  step: Step,
  event: Extract<PublisherEvent, { type: 'publish' }>,
) {
  if (event.stopped) {
    clearNow(step, true);
    return emit(step, { type: 'answer', kind: 'error', error: STOPPED });
  }
  plan(step, { type: 'starting' });
  const { track } = step.state;
  set(step, {
    playing: {
      phrase: event.phrase,
      stopAtMs: event.stopAtMs,
      stopped: false,
      refusal: null,
      stage: { name: 'joining', using: 'early' },
      audioStartsAtMs: 0,
      reveal: 'skipped',
      floor: 'off',
      silenced: false,
      playsUntilMs: 0,
    },
  });
  if (track.status === 'left') return fail(step, STOPPED);
  if (track.status === 'none') {
    play(step, { stage: { name: 'joining', using: 'fresh' } });
    return join(step);
  }
  if (track.status === 'joined') emit(step, { type: 'resume' });
}

/** Back from a yield: the track in hand is used, or the authorization in hand settles. */
function resumed(step: Step) {
  const { playing, track } = step.state;
  if (playing?.stage.name === 'joining' && track.status === 'joined')
    return trackReady(step, track.join, step.facts.usable, 'early');
  const ahead = step.state.asks.find(
    (entry) => entry.holder === 'play' && entry.phraseId === playing?.phrase.id,
  );
  if (playing?.stage.name === 'authorizing' && ahead)
    askSettled(step, ahead.call);
}

function joinSettled(
  step: Step,
  event: Extract<PublisherEvent, { type: 'joined' | 'join-failed' }>,
) {
  const { track, playing } = step.state;
  const current = track.status === 'joining' && track.join === event.join;
  const using =
    playing?.stage.name === 'joining' && current ? playing.stage.using : null;
  if (event.type === 'join-failed') {
    if (current) set(step, { track: { status: 'none' } });
    if (step.state.claim === 'leaving') return left(step);
    if (using === 'early') {
      play(step, { stage: { name: 'joining', using: 'fresh' } });
      return join(step);
    }
    if (using !== null) fail(step, STOPPED);
    return;
  }
  set(step, { room: event.room, roomLeft: false });
  if (!current) return emit(step, { type: 'leave', join: event.join });
  set(step, { track: { status: 'joined', join: event.join } });
  if (using !== null) trackReady(step, event.join, event.usable, using);
}

/** The track in hand: used unless it broke or its room was retired, then joined afresh. */
function trackReady(
  step: Step,
  joinId: number,
  usable: boolean,
  using: 'early' | 'fresh' | 'replace',
) {
  if (using === 'replace' || (usable && !step.state.roomLeft))
    return joinedForPlay(step);
  emit(step, { type: 'leave', join: joinId });
  play(step, { stage: { name: 'joining', using: 'replace' } });
  join(step);
}

function joinedForPlay(step: Step) {
  const { playing, room } = step.state;
  if (!playing) return;
  if (playing.stopped) {
    clearNow(step, true);
    return fail(step, STOPPED);
  }
  // A whole phrase that cannot finish before the cutoff is never started.
  if (
    now(step) + step.queuedMs + playing.phrase.durationMs >
    playing.stopAtMs
  ) {
    discard(step);
    return answer(step, {
      kind: 'outcome',
      outcome: { complete: false, segmentEnded: true },
    });
  }
  if (room === null) return fail(step, STOPPED);
  const ahead = step.state.asks.find(
    (entry) => entry.holder === 'ahead' && entry.phraseId === playing.phrase.id,
  );
  set(step, {
    asks: step.state.asks.map((entry) =>
      entry === ahead ? { ...entry, holder: 'play' } : entry,
    ),
  });
  plan(step, { type: 'consume', phraseId: playing.phrase.id });
  play(step, { stage: { name: 'authorizing', fresh: !ahead } });
  if (!ahead)
    authorize(step, playing.phrase, Math.round(step.queuedMs), 'play');
  retryUnfinished(step);
  if (ahead && ahead.outcome !== 'pending') emit(step, { type: 'resume' });
}

/** An authorization settled; the phrase in play goes on, asks afresh, or stops. */
function askSettled(step: Step, callId: number) {
  const entry = step.state.asks.find((ask) => ask.call === callId);
  const { playing } = step.state;
  if (!entry || entry.holder === 'ahead') return;
  set(step, { asks: step.state.asks.filter((ask) => ask !== entry) });
  if (entry.holder === 'none' || playing?.stage.name !== 'authorizing') return;
  if (entry.outcome === 'granted') return authorized(step);
  if (entry.outcome === 'pending') return;
  // One asked ahead that failed for a passing reason is asked again now.
  if (!playing.stage.fresh && entry.outcome.transient) {
    play(step, { stage: { name: 'authorizing', fresh: true } });
    return authorize(step, playing.phrase, Math.round(step.queuedMs), 'play');
  }
  noteRoom(step, entry.outcome);
  fail(step, entry.outcome.error);
}

function authorized(step: Step) {
  const { playing } = step.state;
  if (!playing) return;
  if (playing.stopped) {
    clearNow(step, true);
    return fail(step, STOPPED);
  }
  const audioStartsAtMs = now(step) + step.queuedMs;
  plan(step, {
    type: 'scheduled',
    endsAtMs: audioStartsAtMs + playing.phrase.durationMs,
    nowMs: now(step),
  });
  play(step, {
    stage: { name: 'writing' },
    audioStartsAtMs,
    reveal: 'waiting',
    floor: 'waiting',
  });
  const phraseId = playing.phrase.id;
  emit(step, {
    type: 'wait',
    wait: { kind: 'audio-start', phraseId },
    untilMs: audioStartsAtMs,
  });
  emit(step, {
    type: 'wait',
    wait: { kind: 'floor', phraseId },
    untilMs: now(step) + FLOOR_WATCH_MS,
  });
  emit(step, { type: 'write', stopAtMs: playing.stopAtMs });
}

/** A reveal not yet sent never is, once its phrase cannot be said. */
const skipReveal = (step: Step) => {
  const { playing } = step.state;
  if (playing?.reveal !== 'waiting') return;
  play(step, { reveal: 'skipped' });
  emit(step, {
    type: 'cancel',
    wait: { kind: 'audio-start', phraseId: playing.phrase.id },
  });
  revealDone(step);
};

/** Its line cannot be written: it stops, and the speech says it again. */
function refuse(step: Step, failure: Failure) {
  const { playing } = step.state;
  noteRoom(step, failure);
  if (!playing || playing.refusal) return;
  play(step, { refusal: failure });
  if (playing.stage.name === 'writing') emit(step, { type: 'stop-writing' });
  skipReveal(step);
}

function stop(step: Step) {
  const { playing } = step.state;
  if (!playing || playing.stopped) return;
  play(step, { stopped: true });
  const { stage } = playing;
  if (stage.name === 'authorizing') clearNow(step, true);
  if (stage.name === 'writing') emit(step, { type: 'stop-writing' });
  if (stage.name === 'revealing' && !stage.written.aborted)
    clearNow(step, true);
  skipReveal(step);
}

function woke(step: Step, target: Wait) {
  if (target.kind === 'retry') return askAgain(step, target.call);
  if (target.kind === 'tail') return tailPlayed(step);
  const { playing } = step.state;
  if (playing?.phrase.id !== target.phraseId) return;
  if (target.kind === 'floor') {
    if (playing.floor !== 'waiting') return;
    play(step, { floor: 'reading' });
    return emit(step, {
      type: 'watch-floor',
      phraseId: target.phraseId,
      room: step.state.room ?? '',
    });
  }
  if (playing.reveal !== 'waiting') return;
  record(step, { type: 'reveal', phraseId: target.phraseId });
  play(step, { reveal: 'asking' });
  call(step, {
    kind: 'reveal',
    phrase: playing.phrase,
    room: step.state.room ?? '',
    startedAtMs: dbInstant(step, playing.audioStartsAtMs),
  });
}

function floorRead(step: Step, phraseId: string, failure: Failure | null) {
  const { playing } = step.state;
  const current = playing?.phrase.id === phraseId;
  if (failure && !failure.transient) {
    if (current) refuse(step, failure);
    else noteRoom(step, failure);
  }
  if (!current || playing.floor !== 'reading') return;
  if (step.state.playing?.refusal) return play(step, { floor: 'off' });
  play(step, { floor: 'waiting' });
  emit(step, {
    type: 'wait',
    wait: { kind: 'floor', phraseId },
    untilMs: now(step) + FLOOR_WATCH_MS,
  });
}

function written(step: Step, result: Written) {
  const { playing } = step.state;
  if (playing?.stage.name !== 'writing') return;
  const phraseId = playing.phrase.id;
  if (playing.floor === 'waiting')
    emit(step, { type: 'cancel', wait: { kind: 'floor', phraseId } });
  play(step, {
    floor: 'off',
    stage: { name: 'revealing', written: result },
    // Cut before its first frame, or stopped: what is queued never plays.
    silenced: result.sentSamples === 0 || result.aborted,
  });
  if (result.aborted) {
    record(step, { type: 'clear', atMs: now(step) });
    scheduledNow(step);
    discard(step);
  } else {
    const playsUntilMs = now(step) + step.queuedMs;
    play(step, { playsUntilMs });
    record(step, {
      type: 'handed',
      phraseId,
      sentSamples: result.sentSamples,
      phraseSamples: playing.phrase.samples,
      playsUntilMs,
    });
  }
  if (step.state.playing?.silenced) skipReveal(step);
  revealDone(step);
}

/** Once its reveal settled and its audio was handed over, the phrase ends. */
function revealDone(step: Step) {
  const { playing } = step.state;
  if (
    playing?.stage.name !== 'revealing' ||
    playing.reveal === 'waiting' ||
    playing.reveal === 'asking'
  )
    return;
  const { written: result } = playing.stage;
  const { phrase, refusal } = playing;
  const fractionOf = (samples: number) => Math.min(1, samples / phrase.samples);
  if (result.aborted) {
    const error =
      refusal?.error ?? (result.failure === undefined ? null : result.failure);
    return endThenAnswer(
      step,
      fractionOf(result.playedSamples),
      error === null
        ? { kind: 'outcome', outcome: { complete: false, segmentEnded: false } }
        : { kind: 'error', error },
    );
  }
  if (refusal || playing.stopped) {
    const cutAtMs =
      lineCutAt(step.state.lines, phrase.id) ??
      Math.min(now(step), playing.playsUntilMs);
    clearNow(step, true);
    scheduledNow(step);
    return endThenAnswer(
      step,
      playedFraction({
        sentSamples: result.sentSamples,
        phraseSamples: phrase.samples,
        playsUntilMs: playing.playsUntilMs,
        cutAtMs,
      }),
      { kind: 'error', error: refusal?.error ?? STOPPED },
    );
  }
  record(step, { type: 'reported', phraseId: phrase.id });
  set(step, {
    closes: [
      ...step.state.closes,
      { phrase, playsUntilMs: playing.playsUntilMs, status: 'queued' },
    ],
  });
  nextClose(step);
  if (result.cut) discard(step);
  answer(step, {
    kind: 'outcome',
    outcome: { complete: !result.cut, segmentEnded: result.cut },
  });
}

/** Closes the line of a phrase that stopped, if one may have been written, then answers. */
function endThenAnswer(step: Step, fraction: number, outcome: Answer) {
  const { playing } = step.state;
  if (!playing) return;
  const ending = lineRevealed(step.state.lines, playing.phrase.id)
    ? settleLine(step, playing.phrase, fraction)
    : null;
  if (ending === null) return answer(step, outcome);
  play(step, { stage: { name: 'ending', call: ending, answer: outcome } });
}

/** The publish ends: refused or stopped ones forget what was asked after them. */
const fail = (step: Step, error: unknown) => {
  discard(step);
  answer(step, { kind: 'error', error });
};
const answer = (step: Step, outcome: Answer) => {
  plan(step, { type: 'finished' });
  set(step, { playing: null, ahead: [] });
  emit(step, { type: 'answer', ...outcome });
};

/** Closes a line at what played; returns the end call asked, if one was. */
function settleLine(step: Step, phrase: PhraseFacts, fraction: number) {
  const [effect] = record(step, {
    type: 'end',
    phraseId: phrase.id,
    fraction,
  });
  if (!effect) return null;
  const end: LineEnd =
    effect.fraction >= 1
      ? { kind: 'whole' }
      : {
          kind: 'cut',
          spoken: spokenPrefix(phrase.text, effect.fraction),
          playedMs: Math.round(effect.fraction * phrase.durationMs),
        };
  set(step, {
    ends: [
      ...step.state.ends.filter((entry) => entry.phraseId !== phrase.id),
      { phraseId: phrase.id, end },
    ],
  });
  return call(step, { kind: 'end', phraseId: phrase.id, end });
}

/** Asks again every end that failed for a passing reason. */
function retryUnfinished(step: Step) {
  for (const effect of record(step, { type: 'retry' })) {
    const asked = step.state.ends.find(
      ({ phraseId }) => phraseId === effect.phraseId,
    );
    if (!asked) continue;
    const id = call(step, {
      kind: 'end',
      phraseId: asked.phraseId,
      end: asked.end,
    });
    set(step, { retrying: [...step.state.retrying, id] });
  }
}

/** The head of the closing chain waits for its tail to play out, then closes. */
function nextClose(step: Step) {
  const [head] = step.state.closes;
  if (!head) return drained(step);
  if (head.status !== 'queued') return;
  set(step, {
    closes: [{ ...head, status: 'waiting' }, ...step.state.closes.slice(1)],
  });
  if (step.state.claim !== 'open') return tailPlayed(step);
  emit(step, {
    type: 'wait',
    wait: { kind: 'tail', phraseId: head.phrase.id },
    untilMs: head.playsUntilMs,
  });
}
function tailPlayed(step: Step) {
  const [head, ...rest] = step.state.closes;
  if (head?.status !== 'waiting') return;
  const ending = lineRevealed(step.state.lines, head.phrase.id)
    ? settleLine(
        step,
        head.phrase,
        lineCredit(step.state.lines, head.phrase.id),
      )
    : null;
  if (ending !== null)
    return set(step, {
      closes: [{ ...head, status: { call: ending } }, ...rest],
    });
  set(step, { closes: rest });
  nextClose(step);
}

/** A call's answer, or a failure no retry clears: routed to whoever waits on it. */
function callSettled(
  step: Step,
  event: Extract<PublisherEvent, { type: 'answered' | 'refused' }>,
) {
  const asked = step.state.calls.find(({ id }) => id === event.call);
  if (!asked) return;
  if (event.type === 'refused') {
    const writes = asked.args.kind !== 'end';
    const { failure } = event;
    if (
      failure.transient &&
      asked.attempt < ATTEMPTS &&
      !(writes && step.state.claim !== 'open')
    ) {
      set(step, {
        calls: step.state.calls.map((entry) =>
          entry === asked ? { ...entry, last: failure } : entry,
        ),
      });
      return emit(step, {
        type: 'wait',
        wait: { kind: 'retry', call: asked.id },
        untilMs: now(step) + RETRY_MS * asked.attempt,
      });
    }
    return settled(step, asked, failure);
  }
  settled(step, asked, null);
}

function askAgain(step: Step, id: number) {
  const asked = step.state.calls.find((entry) => entry.id === id);
  if (!asked) return;
  // A start or reveal backing off stops once the claim ended: nothing new is written.
  if (asked.args.kind !== 'end' && step.state.claim !== 'open' && asked.last)
    return settled(step, asked, asked.last);
  set(step, {
    calls: step.state.calls.map((entry) =>
      entry === asked
        ? { ...entry, attempt: entry.attempt + 1, last: null }
        : entry,
    ),
  });
  emit(step, { type: 'call', call: id, args: asked.args });
}

function settled(step: Step, asked: Call, failure: Failure | null) {
  set(step, { calls: step.state.calls.filter((entry) => entry !== asked) });
  switch (asked.args.kind) {
    case 'authorize':
      set(step, {
        asks: step.state.asks.map((entry) =>
          entry.call === asked.id
            ? { ...entry, outcome: failure ?? 'granted' }
            : entry,
        ),
      });
      return askSettled(step, asked.id);
    case 'reveal': {
      const { playing } = step.state;
      if (playing?.reveal !== 'asking') return;
      play(step, { reveal: 'settled' });
      if (failure) refuse(step, failure);
      return revealDone(step);
    }
    case 'end':
      return endSettled(step, asked, failure);
  }
}

function endSettled(step: Step, asked: Call, failure: Failure | null) {
  const { phraseId } =
    asked.args.kind === 'end' ? asked.args : { phraseId: '' };
  const retry = failure?.transient ?? false;
  record(step, { type: 'end-result', phraseId, retry });
  if (!retry)
    set(step, {
      ends: step.state.ends.filter((entry) => entry.phraseId !== phraseId),
    });
  const { playing } = step.state;
  if (playing?.stage.name === 'ending' && playing.stage.call === asked.id)
    return answer(step, playing.stage.answer);
  const [head, ...rest] = step.state.closes;
  if (
    head &&
    typeof head.status === 'object' &&
    head.status.call === asked.id
  ) {
    set(step, { closes: rest });
    return nextClose(step);
  }
  if (step.state.retrying.includes(asked.id)) {
    set(step, {
      retrying: step.state.retrying.filter((id) => id !== asked.id),
    });
    drained(step);
  }
}

/**
 * Ends the claim: silences it at once, closes every played line at what was
 * heard, asks again the ends still unfinished, then leaves the track.
 */
function close(step: Step) {
  if (step.state.claim !== 'open') return;
  clearNow(step, true);
  set(step, { claim: 'draining', drain: 'closes' });
  // Waits that end with the claim end now.
  for (const asked of step.state.calls)
    if (asked.args.kind !== 'end' && asked.last) {
      emit(step, { type: 'cancel', wait: { kind: 'retry', call: asked.id } });
      settled(step, asked, asked.last);
    }
  skipReveal(step);
  const [head] = step.state.closes;
  if (head?.status === 'waiting') {
    emit(step, {
      type: 'cancel',
      wait: { kind: 'tail', phraseId: head.phrase.id },
    });
    tailPlayed(step);
  }
  drained(step);
}

/** Moves the claim's end on once what it waits for has settled. */
function drained(step: Step) {
  const { claim, drain, closes, retrying, track } = step.state;
  if (claim !== 'draining') return;
  if (drain === 'closes' && closes.length === 0)
    set(step, { drain: 'retries' });
  if (step.state.drain === 'retries' && retrying.length === 0) {
    set(step, { drain: 'last' });
    retryUnfinished(step);
  }
  if (step.state.drain !== 'last' || step.state.retrying.length > 0) return;
  set(step, { claim: 'leaving', drain: null, track: { status: 'left' } });
  if (track.status === 'joined')
    return emit(step, { type: 'leave', join: track.join });
  if (track.status === 'joining') return;
  set(step, { claim: 'closed' });
  emit(step, { type: 'closed' });
}

/** The track closed; a join still in flight at the claim's end is left once it lands. */
function left(step: Step) {
  if (step.state.claim !== 'leaving') return;
  set(step, { claim: 'closed' });
  emit(step, { type: 'closed' });
}
