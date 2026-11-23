import { isAppError } from '@daisy/errors';
import { spokenPrefix } from '@daisy/protocol/authored-speech';
import {
  emptyLineLedger,
  lineCredit,
  lineCutAt,
  lineRevealed,
  nextLineLedger,
  playedFraction,
  type LineEnd,
  type LineEvent,
} from './line-ledger';
import {
  emptyPublicationSchedule,
  nextPublicationSchedule,
  type ScheduleEvent,
} from './publication-schedule';

/**
 * A claim's publisher as one pure step (R4.3, ADR 0122): state and an event
 * in, the next state and the effects to perform out. It decides what is
 * authorized and when, what starts, what is cut and where, each line's
 * credit, the hard stop, which calls are asked again, and how the claim
 * drains. The shell performs the effects and reports each result as the
 * next event.
 */

/** A failed call: `transient` (a lost reply, a timeout) is worth asking again. */
type Failure = {
  readonly error: unknown;
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
/** How a published phrase ended: whole, cut at the segment end, or stopped. */
export type PhraseOutcome = {
  readonly complete: boolean;
  readonly segmentEnded: boolean;
};
type Line = {
  readonly phraseId: string;
  readonly text: string;
  readonly durationMs: number;
};
/** A store call, in the store's terms. */
export type StoreCall = { readonly room: string } & (
  | {
      readonly kind: 'begin';
      readonly phrase: Line & {
        readonly startsInMs: number;
        readonly startsAt?: string;
      };
    }
  | {
      readonly kind: 'reveal';
      readonly phrase: Line;
      readonly startedAt: string | undefined;
    }
  | { readonly kind: 'end'; readonly phraseId: string; readonly end: LineEnd }
  | { readonly kind: 'floor'; readonly phraseId: string }
);
type Call = {
  readonly id: number;
  readonly args: StoreCall;
  readonly attempt: number;
  /** Set while it backs off after a passing failure. */
  readonly last: Failure | null;
};
/** An authorization, held for a phrase asked ahead, for the phrase in play, or by nobody. */
type Ask = {
  readonly phraseId: string;
  readonly call: number;
  readonly holder: 'ahead' | 'play' | 'none';
  readonly outcome: 'pending' | 'granted' | Failure;
};
type Answer =
  | { readonly kind: 'outcome'; readonly outcome: PhraseOutcome }
  | { readonly kind: 'error'; readonly error: unknown };
type Stage =
  /** `early` uses the join begun ahead of speech; `replace` follows a broken one. */
  | { readonly name: 'joining'; readonly using: 'early' | 'fresh' | 'replace' }
  /** `fresh` once asked at play rather than ahead. */
  | { readonly name: 'authorizing'; readonly fresh: boolean }
  | { readonly name: 'writing' }
  | { readonly name: 'revealing'; readonly written: Written }
  | { readonly name: 'ending'; readonly call: number; readonly answer: Answer };
type Playing = {
  readonly phrase: PhraseFacts;
  readonly stopAtMs: number;
  readonly stopped: boolean;
  readonly refusal: Failure | null;
  readonly stage: Stage;
  readonly audioStartsAtMs: number;
  readonly playsUntilMs: number;
  readonly reveal: 'waiting' | 'asking' | 'settled' | 'skipped';
  readonly floor: 'waiting' | 'reading' | 'off';
};
/** A played phrase's line, closed in turn once its queued tail played out. */
type Closing = {
  readonly phrase: PhraseFacts;
  readonly playsUntilMs: number;
  readonly status: 'queued' | 'waiting' | { readonly call: number };
};
export type PublisherState = {
  readonly claim: 'open' | 'closing' | 'leaving' | 'closed';
  /** What the claim's end waits on: closes, then retries, then a last retry. */
  readonly drain: 'closes' | 'retries' | 'last';
  readonly track:
    | { readonly status: 'none' | 'left' }
    | { readonly status: 'joining' | 'joined'; readonly join: number };
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
  readonly playing: Playing | null;
  readonly closes: readonly Closing[];
  /** Ends asked again, which the claim's end waits for. */
  readonly retrying: readonly number[];
  readonly sequence: number;
};
export type Wait =
  | { readonly kind: 'retry'; readonly call: number }
  | {
      readonly kind: 'audio-start' | 'floor' | 'tail';
      readonly phraseId: string;
    };
/** An event as the shell reports it, before the track's state is read beside it. */
export type PublisherEventBody =
  | {
      readonly type:
        'start' | 'stop' | 'silence' | 'discard' | 'close' | 'resumed';
    }
  /** The database clock, read around one request sent at `sentAtMs`. */
  | {
      readonly type: 'clock-read';
      readonly sentAtMs: number;
      readonly serverNowMs: number;
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
  | { readonly type: 'refused'; readonly call: number; readonly error: unknown }
  | { readonly type: 'woke'; readonly wait: Wait }
  | { readonly type: 'written'; readonly written: Written };
/** An event, read with the track's state: the time, its queue and its health. */
export type PublisherEvent = PublisherEventBody & {
  readonly nowMs: number;
  readonly queuedMs: number;
  readonly trackUsable: boolean;
};
export type PublisherEffect =
  | { readonly type: 'join' | 'leave'; readonly join: number }
  | { readonly type: 'call'; readonly call: number; readonly args: StoreCall }
  | { readonly type: 'write'; readonly stopAtMs: number }
  /**
   * `resume` hands control back before going on: a track or authorization
   * already in hand is still taken asynchronously, so what the speaker asks
   * right after a publish (the next phrase ahead) lands first.
   */
  | { readonly type: 'stop-writing' | 'clear-queue' | 'closed' | 'resume' }
  | { readonly type: 'wait'; readonly wait: Wait; readonly untilMs: number }
  | { readonly type: 'cancel'; readonly wait: Wait }
  | ({ readonly type: 'answer' } & Answer);

/** The refusal a stopped publish, or one that cannot go on, answers with. */
export const STOPPED = Symbol('stopped');
/** Attempts at a call failing for a reason a retry may clear. */
const ATTEMPTS = 3;
const RETRY_MS = 100;
/** How often a playing phrase re-reads its floor beside its audio. */
const FLOOR_WATCH_MS = 250;
const SEGMENT_ENDED: Answer = {
  kind: 'outcome',
  outcome: { complete: false, segmentEnded: true },
};

/** A refusal is an answer; anything else (a lost reply, a timeout) is worth asking again. */
const failureOf = (error: unknown): Failure => ({
  error,
  transient:
    !isAppError(error) ||
    !['CONFLICT', 'AUTHORIZATION', 'VALIDATION', 'NOT_FOUND'].includes(
      error.code,
    ),
  roomChanged: isAppError(error) && error.reason === 'bot-room-changed',
});
/** The monotonic instant of a database one: never later than the database's own. */
export const localInstant = (state: PublisherState, databaseMs: number) =>
  databaseMs - (state.dbOffsetMs ?? 0);

export const emptyPublisher = (): PublisherState => ({
  claim: 'open',
  drain: 'closes',
  track: { status: 'none' },
  room: null,
  roomLeft: false,
  dbOffsetMs: null,
  lines: emptyLineLedger(),
  schedule: emptyPublicationSchedule(),
  ahead: [],
  asks: [],
  calls: [],
  playing: null,
  closes: [],
  retrying: [],
  sequence: 0,
});

/** One step's working copy: the state so far, its effects, the track now. */
type Step = {
  state: PublisherState;
  readonly effects: PublisherEffect[];
  readonly event: PublisherEvent;
  queuedMs: number;
};

export function stepPublisher(state: PublisherState, event: PublisherEvent) {
  const effects: PublisherEffect[] = [];
  const step = { state, effects, event, queuedMs: Math.max(0, event.queuedMs) };
  handle(step, event);
  return { state: step.state, effects: effects as readonly PublisherEffect[] };
}

const set = (step: Step, change: Partial<PublisherState>) => {
  step.state = { ...step.state, ...change };
};
const emit = (step: Step, effect: PublisherEffect) => {
  step.effects.push(effect);
};
const now = (step: Step) => step.event.nowMs;
const record = (step: Step, event: LineEvent) => {
  const next = nextLineLedger(step.state.lines, event);
  set(step, { lines: next.state });
  return next.effects;
};
const play = (step: Step, change: Partial<Playing>) => {
  const { playing } = step.state;
  if (playing) set(step, { playing: { ...playing, ...change } });
};
const nextId = (step: Step) => {
  set(step, { sequence: step.state.sequence + 1 });
  return step.state.sequence;
};
const noteRoom = (step: Step, failure: Failure) =>
  set(step, { roomLeft: failure.roomChanged });
const wait = (step: Step, target: Wait, untilMs: number) =>
  emit(step, { type: 'wait', wait: target, untilMs });
/** An instant on the database clock, once its offset is known. */
const dbInstant = (step: Step, monotonicMs: number) =>
  step.state.dbOffsetMs === null
    ? undefined
    : new Date(monotonicMs + step.state.dbOffsetMs).toISOString();
const lineOf = ({ id, text, durationMs }: PhraseFacts): Line => ({
  phraseId: id,
  text,
  durationMs,
});

function handle(step: Step, event: PublisherEvent) {
  switch (event.type) {
    case 'start':
      if (step.state.track.status === 'none') join(step);
      return;
    case 'clock-read':
      return set(step, { dbOffsetMs: event.serverNowMs - event.sentAtMs });
    case 'write-ahead': {
      const { id } = event.phrase;
      const ahead = step.state.ahead.filter((phrase) => phrase.id !== id);
      set(step, { ahead: [...ahead, event.phrase] });
      const joined = step.state.room !== null;
      return plan(step, {
        type: 'prepare',
        phraseId: id,
        joined,
        nowMs: now(step),
      });
    }
    case 'silence':
      return clearNow(step, false);
    case 'discard':
      return discard(step);
    case 'publish':
      return publish(step, event);
    case 'resumed':
      return resumed(step);
    case 'stop':
      return stop(step);
    case 'close':
      return close(step);
    case 'joined':
    case 'join-failed':
      return joinSettled(step, event);
    case 'left':
      return left(step);
    case 'answered':
      return settled(step, event.call, null);
    case 'refused':
      return refused(step, event.call, failureOf(event.error));
    case 'woke':
      return woke(step, event.wait);
    case 'written':
      return written(step, event.written);
  }
}

const join = (step: Step) => {
  const id = nextId(step);
  set(step, { track: { status: 'joining', join: id } });
  emit(step, { type: 'join', join: id });
};
/** Forgets phrases authorized ahead: nothing was written for them. */
const discard = (step: Step) => {
  plan(step, { type: 'discard' });
  const asks = step.state.asks.map((ask) =>
    ask.holder === 'ahead' ? { ...ask, holder: 'none' as const } : ask,
  );
  set(step, { ahead: [], asks });
};
/** Silences what is queued, recording the clear, and forgets what was asked ahead. */
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
  for (const { phraseId, startsInMs } of next.effects) {
    const phrase = step.state.ahead.find(({ id }) => id === phraseId);
    const ahead = step.state.ahead.filter(({ id }) => id !== phraseId);
    set(step, { ahead });
    if (phrase && step.state.room !== null)
      authorize(step, phrase, startsInMs, 'ahead');
  }
};
const scheduledNow = (step: Step) =>
  plan(step, { type: 'scheduled', endsAtMs: now(step), nowMs: now(step) });

/** Starts a store call; a passing failure asks it again, up to `ATTEMPTS`. */
const call = (step: Step, args: StoreCall) => {
  const id = nextId(step);
  const asked: Call = { id, args, attempt: 1, last: null };
  set(step, { calls: [...step.state.calls, asked] });
  emit(step, { type: 'call', call: id, args });
  return id;
};
const room = (step: Step) => step.state.room ?? '';
/** Authorizes a phrase, its audio starting `startsInMs` from now; it writes nothing. */
function authorize(
  step: Step,
  phrase: PhraseFacts,
  startsInMs: number,
  holder: Ask['holder'],
) {
  const startsAt = dbInstant(step, now(step) + startsInMs);
  const id = call(step, {
    kind: 'begin',
    phrase: { ...lineOf(phrase), startsInMs, ...(startsAt && { startsAt }) },
    room: room(step),
  });
  const ask: Ask = {
    phraseId: phrase.id,
    call: id,
    holder,
    outcome: 'pending',
  };
  set(step, { asks: [...step.state.asks, ask] });
}

function publish(
  step: Step,
  event: Extract<PublisherEventBody, { type: 'publish' }>,
) {
  if (event.stopped) {
    clearNow(step, true);
    return emit(step, { type: 'answer', kind: 'error', error: STOPPED });
  }
  plan(step, { type: 'starting' });
  const { status } = step.state.track;
  const using = status === 'none' ? 'fresh' : 'early';
  set(step, {
    playing: {
      phrase: event.phrase,
      stopAtMs: event.stopAtMs,
      stopped: false,
      refusal: null,
      stage: { name: 'joining', using },
      audioStartsAtMs: 0,
      playsUntilMs: 0,
      reveal: 'skipped',
      floor: 'off',
    },
  });
  if (status === 'left') return fail(step, STOPPED);
  if (status === 'none') return join(step);
  if (status === 'joined') emit(step, { type: 'resume' });
}

/** Back from a yield: the track in hand is used, or the authorization in hand settles. */
function resumed(step: Step) {
  const { playing, track, asks } = step.state;
  if (playing?.stage.name === 'joining' && track.status === 'joined')
    return trackReady(step, track.join, step.event.trackUsable, 'early');
  const id = playing?.phrase.id;
  const held = asks.find((ask) => ask.holder === 'play' && ask.phraseId === id);
  if (playing?.stage.name === 'authorizing' && held)
    askSettled(step, held.call);
}

function joinSettled(
  step: Step,
  event: Extract<PublisherEventBody, { type: 'joined' | 'join-failed' }>,
) {
  const { track, playing } = step.state;
  const current = track.status === 'joining' && track.join === event.join;
  const using =
    playing?.stage.name === 'joining' && current ? playing.stage.using : null;
  if (event.type === 'join-failed') {
    if (current) set(step, { track: { status: 'none' } });
    if (step.state.claim === 'leaving') return left(step);
    // A failed early join is joined again once, not reported as speech.
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

/** The track in hand is used, unless it broke or its room was retired. */
function trackReady(step: Step, id: number, usable: boolean, using: string) {
  if (using === 'replace' || (usable && !step.state.roomLeft))
    return joinedForPlay(step);
  emit(step, { type: 'leave', join: id });
  play(step, { stage: { name: 'joining', using: 'replace' } });
  join(step);
}

function joinedForPlay(step: Step) {
  const { playing } = step.state;
  if (!playing) return;
  if (playing.stopped) return stopped(step);
  const { phrase } = playing;
  // A whole phrase that cannot finish before the cutoff is never started.
  if (now(step) + step.queuedMs + phrase.durationMs > playing.stopAtMs) {
    discard(step);
    return answer(step, SEGMENT_ENDED);
  }
  if (step.state.room === null) return fail(step, STOPPED);
  const ahead = step.state.asks.find(
    (ask) => ask.holder === 'ahead' && ask.phraseId === phrase.id,
  );
  const asks = step.state.asks.map((ask) =>
    ask === ahead ? { ...ask, holder: 'play' as const } : ask,
  );
  set(step, { asks });
  plan(step, { type: 'consume', phraseId: phrase.id });
  play(step, { stage: { name: 'authorizing', fresh: !ahead } });
  if (!ahead) authorize(step, phrase, Math.round(step.queuedMs), 'play');
  retryUnfinished(step);
  if (ahead && ahead.outcome !== 'pending') emit(step, { type: 'resume' });
}

/** An authorization settled: the phrase in play goes on, asks afresh, or stops. */
function askSettled(step: Step, id: number) {
  const held = step.state.asks.find((ask) => ask.call === id);
  const { playing } = step.state;
  if (!held || held.holder === 'ahead') return;
  set(step, { asks: step.state.asks.filter((ask) => ask !== held) });
  if (held.holder === 'none' || playing?.stage.name !== 'authorizing') return;
  if (held.outcome === 'pending') return;
  if (held.outcome === 'granted') return authorized(step, playing);
  // One asked ahead that failed for a passing reason is asked again at play.
  if (!playing.stage.fresh && held.outcome.transient) {
    play(step, { stage: { name: 'authorizing', fresh: true } });
    return authorize(step, playing.phrase, Math.round(step.queuedMs), 'play');
  }
  noteRoom(step, held.outcome);
  fail(step, held.outcome.error);
}

/** Authorized: its reveal waits for its audio, its floor is watched, its frames written. */
function authorized(step: Step, playing: Playing) {
  if (playing.stopped) return stopped(step);
  const audioStartsAtMs = now(step) + step.queuedMs;
  const endsAtMs = audioStartsAtMs + playing.phrase.durationMs;
  plan(step, { type: 'scheduled', endsAtMs, nowMs: now(step) });
  const stage = { name: 'writing' } as const;
  play(step, { stage, audioStartsAtMs, reveal: 'waiting', floor: 'waiting' });
  const phraseId = playing.phrase.id;
  wait(step, { kind: 'audio-start', phraseId }, audioStartsAtMs);
  wait(step, { kind: 'floor', phraseId }, now(step) + FLOOR_WATCH_MS);
  emit(step, { type: 'write', stopAtMs: playing.stopAtMs });
}

/** A reveal not yet sent never is, once its phrase cannot be said. */
function skipReveal(step: Step) {
  const { playing } = step.state;
  if (playing?.reveal !== 'waiting') return;
  play(step, { reveal: 'skipped' });
  const phraseId = playing.phrase.id;
  emit(step, { type: 'cancel', wait: { kind: 'audio-start', phraseId } });
  revealDone(step);
}

/** Its line cannot be written: it stops, and the speech says it again. */
function refuse(step: Step, failure: Failure) {
  const { playing } = step.state;
  noteRoom(step, failure);
  if (!playing || playing.refusal) return;
  play(step, { refusal: failure });
  if (playing.stage.name === 'writing') emit(step, { type: 'stop-writing' });
  skipReveal(step);
}

/** A stop or barge-in silences what is queued at once, unless the writer does. */
function stop(step: Step) {
  const { playing } = step.state;
  if (!playing || playing.stopped) return;
  play(step, { stopped: true });
  const { stage } = playing;
  if (stage.name === 'writing') emit(step, { type: 'stop-writing' });
  if (
    stage.name === 'authorizing' ||
    (stage.name === 'revealing' && !stage.written.aborted)
  )
    clearNow(step, true);
  skipReveal(step);
}
const stopped = (step: Step) => {
  clearNow(step, true);
  fail(step, STOPPED);
};

function woke(step: Step, target: Wait) {
  if (target.kind === 'retry') return askAgain(step, target.call);
  if (target.kind === 'tail') return tailPlayed(step);
  const { playing } = step.state;
  const { phraseId } = target;
  if (playing?.phrase.id !== phraseId) return;
  if (target.kind === 'floor') {
    if (playing.floor !== 'waiting') return;
    play(step, { floor: 'reading' });
    return void call(step, { kind: 'floor', phraseId, room: room(step) });
  }
  if (playing.reveal !== 'waiting') return;
  // Its reveal as its audio starts, dated by its audio, never by its commit.
  record(step, { type: 'reveal', phraseId });
  play(step, { reveal: 'asking' });
  const startedAt = dbInstant(step, playing.audioStartsAtMs);
  const phrase = lineOf(playing.phrase);
  call(step, { kind: 'reveal', phrase, room: room(step), startedAt });
}

/** The floor re-read beside the audio: a refusal stops it; a passing failure reads again. */
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
  wait(step, { kind: 'floor', phraseId }, now(step) + FLOOR_WATCH_MS);
}

function written(step: Step, result: Written) {
  const { playing } = step.state;
  if (playing?.stage.name !== 'writing') return;
  const phraseId = playing.phrase.id;
  if (playing.floor === 'waiting')
    emit(step, { type: 'cancel', wait: { kind: 'floor', phraseId } });
  play(step, { floor: 'off', stage: { name: 'revealing', written: result } });
  if (result.aborted) {
    // Any stop dropped the queue: a reveal not yet asked never writes a line.
    record(step, { type: 'clear', atMs: now(step) });
    scheduledNow(step);
    discard(step);
  } else {
    const playsUntilMs = now(step) + step.queuedMs;
    play(step, { playsUntilMs });
    const { sentSamples } = result;
    const phraseSamples = playing.phrase.samples;
    const handed = { phraseId, sentSamples, phraseSamples, playsUntilMs };
    record(step, { type: 'handed', ...handed });
  }
  // Cut before its first frame, or stopped: none of it will play.
  if (result.aborted || result.sentSamples === 0) skipReveal(step);
  revealDone(step);
}

/** Once its audio was handed over and its reveal settled, the phrase ends. */
function revealDone(step: Step) {
  const { playing } = step.state;
  const { stage, reveal } = playing ?? {};
  if (!playing || stage?.name !== 'revealing') return;
  if (reveal === 'waiting' || reveal === 'asking') return;
  const { written: result } = stage;
  const { phrase, refusal, playsUntilMs } = playing;
  if (result.aborted) {
    const error = refusal ? refusal.error : result.failure;
    const fraction = Math.min(1, result.playedSamples / phrase.samples);
    const outcome = { complete: false, segmentEnded: false };
    return endThenAnswer(
      step,
      fraction,
      error === undefined
        ? { kind: 'outcome', outcome }
        : { kind: 'error', error },
    );
  }
  if (refusal || playing.stopped) {
    // What is queued is silenced; its line closes at the first clear after its handoff.
    const cutAtMs =
      lineCutAt(step.state.lines, phrase.id) ??
      Math.min(now(step), playsUntilMs);
    clearNow(step, true);
    scheduledNow(step);
    const { sentSamples } = result;
    const phraseSamples = phrase.samples;
    const cut = { sentSamples, phraseSamples, playsUntilMs, cutAtMs };
    const error = refusal ? refusal.error : STOPPED;
    return endThenAnswer(step, playedFraction(cut), { kind: 'error', error });
  }
  // Its last frames are still queued: its line closes once they played, in turn.
  record(step, { type: 'reported', phraseId: phrase.id });
  const closing: Closing = { phrase, playsUntilMs, status: 'queued' };
  set(step, { closes: [...step.state.closes, closing] });
  nextClose(step);
  if (result.cut) discard(step);
  const outcome = { complete: !result.cut, segmentEnded: result.cut };
  answer(step, { kind: 'outcome', outcome });
}

/** A stopped phrase's line, if one may have been written, closes before it answers. */
function endThenAnswer(step: Step, fraction: number, outcome: Answer) {
  const { playing } = step.state;
  if (!playing) return;
  const ending = lineRevealed(step.state.lines, playing.phrase.id)
    ? settleLine(step, playing.phrase, fraction)
    : null;
  if (ending === null) return answer(step, outcome);
  play(step, { stage: { name: 'ending', call: ending, answer: outcome } });
}
/** A refused or stopped publish forgets what was asked after it, so lines stay in order. */
const fail = (step: Step, error: unknown) => {
  discard(step);
  answer(step, { kind: 'error', error });
};
const answer = (step: Step, outcome: Answer) => {
  plan(step, { type: 'finished' });
  set(step, { playing: null, ahead: [] });
  emit(step, { type: 'answer', ...outcome });
};

/** Closes a line at what played (AMEND-1); returns the end call, if one was asked. */
function settleLine(step: Step, phrase: PhraseFacts, fraction: number) {
  const end: LineEnd =
    fraction >= 1
      ? { kind: 'whole' }
      : {
          kind: 'cut',
          spoken: spokenPrefix(phrase.text, fraction),
          playedMs: Math.round(fraction * phrase.durationMs),
        };
  const phraseId = phrase.id;
  const [effect] = record(step, { type: 'end', phraseId, end });
  return effect ? call(step, { kind: 'end', phraseId, end, room: '' }) : null;
}
/** Asks again every end that failed for a passing reason: left undone, it reads as said. */
function retryUnfinished(step: Step) {
  for (const { phraseId, end } of record(step, { type: 'retry' })) {
    const id = call(step, { kind: 'end', phraseId, end, room: '' });
    set(step, { retrying: [...step.state.retrying, id] });
  }
}

/** The closing chain's head waits for its tail to play out, then closes its line. */
function nextClose(step: Step): void {
  const [head, ...rest] = step.state.closes;
  if (!head) return drained(step);
  if (head.status !== 'queued') return;
  set(step, { closes: [{ ...head, status: 'waiting' }, ...rest] });
  if (step.state.claim !== 'open') return tailPlayed(step);
  wait(step, { kind: 'tail', phraseId: head.phrase.id }, head.playsUntilMs);
}
function tailPlayed(step: Step): void {
  const [head, ...rest] = step.state.closes;
  if (head?.status !== 'waiting') return;
  const { id } = head.phrase;
  const ending = lineRevealed(step.state.lines, id)
    ? settleLine(step, head.phrase, lineCredit(step.state.lines, id))
    : null;
  if (ending === null) {
    set(step, { closes: rest });
    return nextClose(step);
  }
  set(step, { closes: [{ ...head, status: { call: ending } }, ...rest] });
}

/** A passing failure backs off and asks again; a start or reveal stops once the claim ends. */
function refused(step: Step, id: number, failure: Failure) {
  const asked = step.state.calls.find((entry) => entry.id === id);
  if (!asked) return;
  const { kind } = asked.args;
  const writes = kind === 'begin' || kind === 'reveal';
  if (
    kind === 'floor' ||
    !failure.transient ||
    asked.attempt >= ATTEMPTS ||
    (writes && step.state.claim !== 'open')
  )
    return settled(step, id, failure);
  const calls = step.state.calls.map((entry) =>
    entry === asked ? { ...entry, last: failure } : entry,
  );
  set(step, { calls });
  wait(step, { kind: 'retry', call: id }, now(step) + RETRY_MS * asked.attempt);
}
function askAgain(step: Step, id: number) {
  const asked = step.state.calls.find((entry) => entry.id === id);
  if (!asked) return;
  const again = { ...asked, attempt: asked.attempt + 1, last: null };
  const calls = step.state.calls.map((entry) =>
    entry === asked ? again : entry,
  );
  set(step, { calls });
  emit(step, { type: 'call', call: id, args: asked.args });
}

/** A call's answer, or a failure no retry clears, goes to whoever waits on it. */
function settled(step: Step, id: number, failure: Failure | null) {
  const asked = step.state.calls.find((entry) => entry.id === id);
  if (!asked) return;
  set(step, { calls: step.state.calls.filter((entry) => entry !== asked) });
  const { args } = asked;
  switch (args.kind) {
    case 'begin': {
      const outcome = failure ?? ('granted' as const);
      const asks = step.state.asks.map((ask) =>
        ask.call === id ? { ...ask, outcome } : ask,
      );
      set(step, { asks });
      return askSettled(step, id);
    }
    case 'reveal':
      if (step.state.playing?.reveal !== 'asking') return;
      play(step, { reveal: 'settled' });
      if (failure) refuse(step, failure);
      return revealDone(step);
    case 'floor':
      return floorRead(step, args.phraseId, failure);
    case 'end':
      return endSettled(step, id, args.phraseId, failure);
  }
}
function endSettled(
  step: Step,
  id: number,
  phraseId: string,
  failure: Failure | null,
) {
  // A line counts as closed from its first end; a passing failure is asked again later.
  const retry = failure?.transient ?? false;
  record(step, { type: 'end-result', phraseId, retry });
  const { playing, retrying } = step.state;
  const [head, ...rest] = step.state.closes;
  if (playing?.stage.name === 'ending' && playing.stage.call === id)
    return answer(step, playing.stage.answer);
  if (head && typeof head.status === 'object' && head.status.call === id) {
    set(step, { closes: rest });
    return nextClose(step);
  }
  if (!retrying.includes(id)) return;
  set(step, { retrying: retrying.filter((entry) => entry !== id) });
  drained(step);
}

/** Ends the claim: silences it, closes every played line at what was heard, then leaves. */
function close(step: Step) {
  if (step.state.claim !== 'open') return;
  clearNow(step, true);
  set(step, { claim: 'closing' });
  // What waited on the claim ends now: starts and reveals backing off, the next reveal, a tail.
  for (const { id, args, last } of step.state.calls)
    if (args.kind !== 'end' && last) {
      emit(step, { type: 'cancel', wait: { kind: 'retry', call: id } });
      settled(step, id, last);
    }
  skipReveal(step);
  const [head] = step.state.closes;
  if (head?.status === 'waiting') {
    const phraseId = head.phrase.id;
    emit(step, { type: 'cancel', wait: { kind: 'tail', phraseId } });
    tailPlayed(step);
  }
  drained(step);
}
/** The claim's end goes on once what it waits on settled, then leaves the track. */
function drained(step: Step) {
  if (step.state.claim !== 'closing') return;
  if (step.state.drain === 'closes' && step.state.closes.length === 0)
    set(step, { drain: 'retries' });
  if (step.state.drain === 'retries' && step.state.retrying.length === 0) {
    set(step, { drain: 'last' });
    retryUnfinished(step);
  }
  const { drain, retrying, track } = step.state;
  if (drain !== 'last' || retrying.length > 0) return;
  set(step, { claim: 'leaving', track: { status: 'left' } });
  if (track.status === 'joined')
    return emit(step, { type: 'leave', join: track.join });
  if (track.status !== 'joining') left(step);
}
/** The track closed, or a join in flight at the claim's end landed and was left. */
function left(step: Step) {
  if (step.state.claim !== 'leaving') return;
  set(step, { claim: 'closed' });
  emit(step, { type: 'closed' });
}
