import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, createRefusal } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import {
  createBotPublisher,
  playedFraction,
  type BotSpeechJob,
} from './publication';
setupRitewayBun();

const scope = {
  roundId: 'r'.repeat(24),
  roundParticipantId: 'p'.repeat(24),
  segmentId: 's'.repeat(24),
} as BotSpeechJob['scope'];
const words = 'one two three four five six seven eight nine ten';
/** A phrase of `ms` milliseconds of 24 kHz mono PCM. */
const job = (ms: number, phraseId = 'f'.repeat(24)): BotSpeechJob => ({
  scope,
  token: 't',
  phraseId,
  text: words,
  pcm: new Int16Array(240 * (ms / 10)).fill(1),
  sampleRate: 24000,
  channels: 1,
});
const waitUntil = (due: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, due - performance.now()));
    signal.addEventListener('abort', done, { once: true });
  });
type End = { phraseId: string; end: unknown; at?: number };
/**
 * A claim's publisher in real time over a stub native track whose queue
 * plays out in real time, and a stub store. `begin` and `verify` decide each
 * phrase's start and floor reads.
 */
function harness(
  options: {
    readonly begin?: () => Promise<unknown>;
    readonly verify?: (call: number) => Promise<unknown>;
    readonly end?: (phraseId: string) => Promise<unknown>;
    readonly reveal?: (phraseId: string) => Promise<unknown>;
    /** Fails the handoff of the n-th frame, counting from 0. */
    readonly failHandoff?: (frame: number) => boolean;
  } = {},
) {
  const events: string[] = [];
  const handoffs: number[] = [];
  /** Each silence the queue played between frames, in ms. */
  const silences: number[] = [];
  const ends: End[] = [];
  const begins: unknown[] = [];
  /** Each line's reveal, as its audio starts. */
  const reveals: { phraseId: string; at: number }[] = [];
  let joins = 0,
    verifies = 0;
  let playedUntil = 0;
  const publisher = createBotPublisher({
    store: {
      verifyRoundBotPublication: async () => {
        const call = verifies++;
        await options.verify?.(call);
        return {
          segmentDueAt: new Date(1_060_000).toISOString(),
          now: new Date(1_000_000).toISOString(),
        };
      },
      // The floor watch shares the read count with the open's read.
      watchRoundBotFloor: async () => {
        const call = verifies++;
        await options.verify?.(call);
      },
      revealRoundBotPhrase: async (
        _scope: unknown,
        _token: unknown,
        phrase: { phraseId: string },
      ) => {
        await options.reveal?.(phrase.phraseId);
        reveals.push({ phraseId: phrase.phraseId, at: performance.now() });
        return { revealed: true };
      },
      beginRoundBotPhrase: async (
        _scope: unknown,
        _token: unknown,
        phrase: unknown,
        room: unknown,
      ) => {
        begins.push({ phrase, room, at: performance.now() });
        await options.begin?.();
        return { duplicate: false };
      },
      endRoundBotPhrase: async (
        _scope: unknown,
        _token: unknown,
        phraseId: string,
        end: unknown,
      ) => {
        await options.end?.(phraseId);
        ends.push({ phraseId, end, at: performance.now() });
        return { changed: true };
      },
    } as never,
    botToken: async () => ({
      url: 'ws://media.test',
      token: 'grant',
      roomName: 'room',
    }),
    connect: async () => {
      const sid = `TR_${joins++}`;
      events.push(`join:${sid}`);
      let closed = false;
      return {
        trackSid: sid,
        usable: () => !closed,
        sentSamples: () => handoffs.length * 240,
        capture10ms: async () => {
          if (options.failHandoff?.(handoffs.length))
            throw new Error('native source failed');
          const now = performance.now();
          handoffs.push(now);
          // Silence heard: the queue ran dry before this frame arrived.
          if (playedUntil > 0 && now > playedUntil)
            silences.push(now - playedUntil);
          playedUntil = Math.max(playedUntil, now) + 10;
        },
        queuedMs: () => Math.max(0, playedUntil - performance.now()),
        clearQueue: () => {
          events.push('clear');
          playedUntil = performance.now();
        },
        close: async () => {
          closed = true;
          events.push(`close:${sid}`);
          return { consumedSamples: 0 };
        },
      } as never;
    },
    nextId: () => 'k'.repeat(24),
    monotonicNowMs: () => performance.now(),
    waitUntilMs: waitUntil,
  });
  return {
    claim: publisher({ scope, token: 't' }),
    events,
    handoffs,
    silences,
    ends,
    begins,
    reveals,
  };
}
const signal = () => new AbortController().signal;
/** Long enough for a phrase's queued tail (the 300 ms lead) to play out. */
const tailPlays = () => Bun.sleep(450);
const far = () => performance.now() + 60_000;

test('phrases stream on the one track joined ahead of speech and close whole', async () => {
  const { claim, events, ends, begins } = harness();
  claim.start();
  const first = await claim.publish(job(50, 'a'.repeat(24)), signal(), far());
  const second = await claim.publish(job(50, 'b'.repeat(24)), signal(), far());
  await tailPlays();
  await claim.close();
  assert({
    given: 'two phrases published by one claim',
    should:
      'join once, start each phrase with its text and length in the joined room, and close each whole',
    actual: {
      first,
      second,
      events,
      ends: ends.map(({ phraseId, end }) => ({ phraseId, end })),
      // When each line's audio starts depends on the queue: checked elsewhere.
      begins: begins.map((row) => {
        const { phrase, room } = row as {
          phrase: { startsInMs: number };
          room: string;
        };
        const { startsInMs, ...rest } = phrase;
        void startsInMs;
        return { phrase: rest, room };
      }),
    },
    expected: {
      first: { complete: true, segmentEnded: false },
      second: { complete: true, segmentEnded: false },
      // Its tail had played out by the end: nothing was left to clear.
      events: ['join:TR_0', 'close:TR_0'],
      ends: [
        { phraseId: 'a'.repeat(24), end: { kind: 'whole' } },
        { phraseId: 'b'.repeat(24), end: { kind: 'whole' } },
      ],
      begins: [
        {
          phrase: { phraseId: 'a'.repeat(24), text: words, durationMs: 50 },
          room: 'room',
        },
        {
          phrase: { phraseId: 'b'.repeat(24), text: words, durationMs: 50 },
          room: 'room',
        },
      ],
    },
  });
});

test('the audio keeps its 10 ms cadence while a floor read beside it stalls 200 ms (ADR 0122)', async () => {
  const { claim, handoffs, ends } = harness({
    // The open's read is quick; every floor read during play takes 200 ms.
    verify: async (call) => {
      if (call > 0) await Bun.sleep(200);
    },
  });
  const start = performance.now();
  const outcome = await claim.publish(job(800), signal(), far());
  await tailPlays();
  const gaps = handoffs.slice(1).map((at, index) => at - handoffs[index]!);
  assert({
    given: 'an 800 ms phrase whose floor reads each take 200 ms',
    should:
      'hand frames over in real time with no gap near 100 ms, and close the line whole',
    actual: {
      outcome,
      frames: handoffs.length,
      paced: performance.now() - start >= 500,
      maxGapUnder60: Math.max(...gaps) < 60,
      ends: ends.map((row) => row.end),
    },
    expected: {
      outcome: { complete: true, segmentEnded: false },
      frames: 80,
      paced: true,
      maxGapUnder60: true,
      ends: [{ kind: 'whole' }],
    },
  });
});

test('a phrase start refused because the room changed plays nothing and rejoins', async () => {
  let refused = false;
  const { claim, handoffs, ends, events } = harness({
    begin: async () => {
      if (refused) return;
      refused = true;
      throw createRefusal('CONFLICT', 'bot-room-changed');
    },
  });
  await assertRejects({
    given: 'a phrase whose start is refused because the session left its room',
    should: 'reject with that refusal',
    actual: () => claim.publish(job(1000), signal(), far()),
    code: 'CONFLICT',
  });
  assert({
    given: 'the refused phrase',
    should: 'hand no frame over and write no line',
    actual: { frames: handoffs.length, ends: ends.map((row) => row.end) },
    expected: { frames: 0, ends: [] },
  });
  await claim.publish(job(20), signal(), far());
  assert({
    given: 'the next phrase after the room changed',
    should: 'join the session’s fresh room on a new track',
    actual: events.filter((event) => event.startsWith('join')),
    expected: ['join:TR_0', 'join:TR_1'],
  });
});

test('a floor lost mid-phrase stops the audio and cuts the line at what played', async () => {
  const lost = createAppError('CONFLICT', 'Bot speaking authority changed');
  // The open's read, then the first floor read pass; the second refuses.
  const { claim, ends, events } = harness({
    verify: async (call) => {
      if (call >= 2) throw lost;
    },
  });
  await assertRejects({
    given: 'a one-second phrase whose floor is lost about 500 ms in',
    should: 'reject with the floor refusal',
    actual: () => claim.publish(job(1000), signal(), far()),
    code: 'CONFLICT',
  });
  const [end] = ends as { end: { kind: string; spoken: string } }[];
  const spoken = end!.end.spoken.split(' ').length;
  assert({
    given: 'the phrase cut by the floor loss',
    should:
      'clear the queue and cut the line to a whole-word prefix near where playout stopped',
    actual: {
      kind: end!.end.kind,
      cleared: events.includes('clear'),
      prefix: words.startsWith(end!.end.spoken),
      aboutHalf: spoken >= 2 && spoken <= 7,
    },
    expected: { kind: 'cut', cleared: true, prefix: true, aboutHalf: true },
  });
});

test('a barge-in cuts the line to the words played, not the words queued (AMEND-1)', async () => {
  const { claim, ends, handoffs } = harness();
  const controller = new AbortController();
  const publishing = claim.publish(job(1000), controller.signal, far());
  await Bun.sleep(300);
  controller.abort();
  const outcome = await publishing;
  const [end] = ends as { end: { kind: string; spoken: string } }[];
  const spoken = end!.end.spoken.split(' ').filter(Boolean).length;
  const sent = handoffs.length;
  assert({
    given:
      'a ten-word one-second phrase aborted about 300 ms in, 100 ms queued',
    should:
      'cut the line to about three words, fewer than the frames sent would claim',
    actual: {
      outcome,
      kind: end!.end.kind,
      playedNotSent: spoken <= Math.round((sent / 100) * 10),
      aboutThree: spoken >= 2 && spoken <= 4,
    },
    expected: {
      outcome: { complete: false, segmentEnded: false },
      kind: 'cut',
      playedNotSent: true,
      aboutThree: true,
    },
  });
});

test('a whole phrase that cannot finish before the segment end is never started', async () => {
  const { claim, begins, handoffs } = harness();
  const outcome = await claim.publish(
    job(500),
    signal(),
    performance.now() + 300,
  );
  assert({
    given: 'a 500 ms phrase with 300 ms left before the hard stop',
    should: 'start nothing, credit nothing and report the segment over',
    actual: { outcome, begins: begins.length, frames: handoffs.length },
    expected: {
      outcome: { complete: false, segmentEnded: true },
      begins: 0,
      frames: 0,
    },
  });
});

test('a phrase that just fits plays whole inside the hard stop (AMEND-2)', async () => {
  const { claim, ends, handoffs } = harness();
  const stopAt = performance.now() + 330;
  const outcome = await claim.publish(job(300), signal(), stopAt);
  await tailPlays();
  assert({
    given: 'a 300 ms phrase with a hard stop 330 ms away',
    should: 'hand every frame over before the stop and close the line whole',
    actual: {
      outcome,
      frames: handoffs.length,
      beforeStop: handoffs.every((at) => at < stopAt),
      ends: ends.map((row) => row.end),
    },
    expected: {
      outcome: { complete: true, segmentEnded: false },
      frames: 30,
      beforeStop: true,
      ends: [{ kind: 'whole' }],
    },
  });
});

test('a speech’s deadline is its segment end on the local clock, never later', async () => {
  const { claim } = harness();
  const before = performance.now();
  const deadline = await claim.deadline();
  const after = performance.now();
  assert({
    given: 'a segment due 60 s after the database’s now',
    should: 'stop 60 s after the earliest instant the read could mean',
    actual: deadline >= before + 60_000 && deadline <= after + 60_000,
    expected: true,
  });
});

test('a phrase’s close stalling 200 ms never delays the next phrase’s audio (ADR 0122)', async () => {
  const { claim, handoffs, ends } = harness({ end: () => Bun.sleep(200) });
  const first = await claim.publish(job(400, 'a'.repeat(24)), signal(), far());
  const boundary = handoffs.length;
  await claim.publish(job(400, 'b'.repeat(24)), signal(), far());
  const gap = handoffs[boundary]! - handoffs[boundary - 1]!;
  const gaps = handoffs.slice(1).map((at, index) => at - handoffs[index]!);
  await tailPlays();
  await Bun.sleep(300);
  assert({
    given: 'two 400 ms phrases whose line closes each take 200 ms',
    should:
      'hand the second phrase’s first frame over at once, keep a 10 ms cadence across the boundary, and close both lines whole in order',
    actual: {
      first,
      boundaryUnder30: gap < 30,
      maxGapUnder60: Math.max(...gaps) < 60,
      ends: ends.map((row) => [row.phraseId[0], row.end]),
    },
    expected: {
      first: { complete: true, segmentEnded: false },
      boundaryUnder30: true,
      maxGapUnder60: true,
      ends: [
        ['a', { kind: 'whole' }],
        ['b', { kind: 'whole' }],
      ],
    },
  });
});

test('a tail cleared after its phrase was handed over closes cut, not whole (AMEND-1)', async () => {
  const { claim, ends } = harness();
  await claim.publish(job(1000, 'a'.repeat(24)), signal(), far());
  // The last 300 ms of phrase a is still queued: a barge-in now cuts it.
  const controller = new AbortController();
  const next = claim.publish(
    job(1000, 'b'.repeat(24)),
    controller.signal,
    far(),
  );
  await Bun.sleep(50);
  controller.abort();
  await next;
  await tailPlays();
  const byId = (id: string) =>
    (ends.find((row) => row.phraseId[0] === id)?.end ?? null) as {
      kind: string;
      spoken?: string;
    } | null;
  const a = byId('a');
  assert({
    given:
      'a ten-word one-second phrase handed over whole, then a barge-in about 250 ms before its tail played',
    should:
      'close it cut to a strict word prefix, about three-quarters of it, never whole, and write nothing for b',
    actual: {
      kind: a?.kind,
      prefix: words.startsWith(a?.spoken ?? 'x'),
      aboutThreeQuarters:
        (a?.spoken?.split(' ').length ?? 0) >= 6 &&
        (a?.spoken?.split(' ').length ?? 0) <= 8,
      nextCut: byId('b')?.kind,
    },
    expected: {
      kind: 'cut',
      prefix: true,
      aboutThreeQuarters: true,
      // b was stopped before its audio started: it has no line at all.
      nextCut: undefined,
    },
  });
});

test('a final phrase whose start fails once is asked again and written before any of its audio (ADR 0122)', async () => {
  let attempts = 0;
  let writtenAt = 0;
  const { claim, ends, handoffs } = harness({
    begin: async () => {
      attempts += 1;
      await Bun.sleep(50);
      if (attempts === 1) throw new Error('statement timeout');
      writtenAt = performance.now();
    },
  });
  await claim.publish(job(100), signal(), far());
  await tailPlays();
  assert({
    given: 'the last phrase of a speech whose start times out once',
    should:
      'ask again under the same line id, hand no frame over before its line is written, and close it whole',
    actual: {
      attempts,
      noFrameBeforeLine: handoffs.every((at) => at >= writtenAt),
      ends: ends.map((row) => row.end),
    },
    expected: {
      attempts: 2,
      noFrameBeforeLine: true,
      ends: [{ kind: 'whole' }],
    },
  });
});

test('a refused phrase start plays none of its audio', async () => {
  let refuse = true;
  const { claim, handoffs } = harness({
    begin: async () => {
      if (refuse) throw createAppError('CONFLICT', 'floor lost');
    },
  });
  await assertRejects({
    given: 'a phrase whose start is refused',
    should: 'refuse it before playing',
    actual: () => claim.publish(job(100, 'a'.repeat(24)), signal(), far()),
    code: 'CONFLICT',
  });
  const refusedFrames = handoffs.length;
  refuse = false;
  await claim.publish(job(100, 'a'.repeat(24)), signal(), far());
  assert({
    given: 'the same phrase refused, then said again once its start is allowed',
    should: 'hand no frame over for the refusal, and play it once written',
    actual: { refusedFrames, played: handoffs.length },
    expected: { refusedFrames: 0, played: 10 },
  });
});

test('a slow phrase start cannot gap one phrase from the next: it is authorized ahead (ADR 0122)', async () => {
  const { claim, silences, begins } = harness({
    begin: () => Bun.sleep(200),
  });
  const second = job(400, 'b'.repeat(24));
  const first = claim.publish(job(400, 'a'.repeat(24)), signal(), far());
  // As the speaker does: the next line is asked for as the current phrase starts.
  claim.writeAhead(second);
  await first;
  const boundary = silences.length;
  await claim.publish(second, signal(), far());
  await tailPlays();
  assert({
    given:
      'two 400 ms phrases whose every start takes 200 ms, the second asked for as the first starts',
    should:
      'play the second straight after the first with no silence, its line dated by when its audio starts',
    actual: {
      silenceAtBoundary: silences.slice(boundary).filter((ms) => ms > 15),
      startsAhead:
        (begins[1] as { phrase: { startsInMs: number } }).phrase.startsInMs >=
        300,
    },
    expected: { silenceAtBoundary: [], startsAhead: true },
  });
});

test('a phrase authorized ahead but never said writes no line', async () => {
  const { claim, ends, reveals } = harness();
  claim.start();
  await Bun.sleep(10);
  const controller = new AbortController();
  const playing = claim.publish(
    job(1000, 'a'.repeat(24)),
    controller.signal,
    far(),
  );
  claim.writeAhead(job(400, 'b'.repeat(24)));
  await Bun.sleep(150);
  controller.abort();
  await playing;
  await Bun.sleep(50);
  assert({
    given: 'a barge-in on a phrase while the next one was authorized ahead',
    should: 'close the line that played as cut, and write nothing for the next',
    actual: {
      reveals: reveals.map((row) => row.phraseId[0]),
      ends: ends.map((row) => [
        row.phraseId[0],
        (row.end as { kind: string }).kind,
      ]),
    },
    expected: { reveals: ['a'], ends: [['a', 'cut']] },
  });
});
test('a line counts as closed from its first end attempt, even when that answer is lost (YmlA)', async () => {
  const { claim } = harness({
    end: async () => {
      throw createAppError('CONFLICT', 'answer lost');
    },
  });
  const controller = new AbortController();
  const playing = claim.publish(
    job(1000, 'a'.repeat(24)),
    controller.signal,
    far(),
  );
  await Bun.sleep(100);
  controller.abort();
  await playing.catch(() => undefined);
  assert({
    given: 'a cut whose end committed but whose answer never came back',
    should: 'report the line closed, so its phrase said again is a new line',
    actual: claim.lineClosed('a'.repeat(24)),
    expected: true,
  });
});

test('a line end that fails for a passing reason is asked again (Ymp0)', async () => {
  let ends = 0;
  const { claim } = harness({
    end: async () => {
      ends += 1;
      if (ends === 1) throw new Error('connection reset');
    },
  });
  await claim.publish(job(50), signal(), far());
  await tailPlays();
  assert({
    given: 'a line end that fails once with a transient error',
    should: 'ask again and close the line',
    actual: ends,
    expected: 2,
  });
});

test('a phrase is cut by the first clear inside its tail, not a later one (YmrR)', async () => {
  const { claim, ends } = harness({ end: () => Bun.sleep(300) });
  await claim.publish(job(400, 'a'.repeat(24)), signal(), far());
  // Phrase a's 300 ms tail is queued; a barge-in on phrase b clears it.
  const controller = new AbortController();
  const next = claim.publish(
    job(1000, 'b'.repeat(24)),
    controller.signal,
    far(),
  );
  await Bun.sleep(100);
  controller.abort();
  await next;
  // A later clear, long after a's tail would have played, must not win.
  await Bun.sleep(500);
  claim.silence();
  await claim.close();
  const a = ends.find((row) => row.phraseId[0] === 'a')?.end as {
    kind: string;
  };
  assert({
    given: 'a phrase whose tail was cleared, with another clear after it',
    should: 'close it cut by the first clear',
    actual: a.kind,
    expected: 'cut',
  });
});

test('a hard-stop cut is measured from what was handed over (Ymu2)', () => {
  assert({
    given:
      'a 10 s phrase stopped at the hard stop after 5 s were handed over, its last 200 ms then cleared',
    should:
      'count 4.8 s of it as played, never the cleared 200 ms, and never past what was handed',
    actual: [
      playedFraction({
        sentSamples: 5 * 24000,
        phraseSamples: 10 * 24000,
        playsUntilMs: 1000,
        cutAtMs: 800,
      }),
      playedFraction({
        sentSamples: 5 * 24000,
        phraseSamples: 10 * 24000,
        playsUntilMs: 1000,
        cutAtMs: null,
      }),
      playedFraction({
        sentSamples: 10 * 24000 + 120,
        phraseSamples: 10 * 24000,
        playsUntilMs: 1000,
        cutAtMs: null,
      }),
    ],
    expected: [0.48, 0.5, 1],
  });
});

test('a phrase’s length reaches its start as an exact whole number of milliseconds', async () => {
  const { claim, begins } = harness();
  // 201 frames: (48240 / 24000) * 1000 is 2009.9999999999998 in floating point.
  await claim.publish(
    { ...job(10), pcm: new Int16Array(240 * 201).fill(1) },
    signal(),
    far(),
  );
  await tailPlays();
  assert({
    given: 'a phrase of 201 whole frames',
    should: 'start its line with a length of exactly 2010 ms',
    actual: (begins[0] as { phrase: { durationMs: number } }).phrase.durationMs,
    expected: 2010,
  });
});

test('a floor read that fails for a passing reason does not cut the phrase', async () => {
  const { claim, ends, handoffs } = harness({
    verify: async (call) => {
      if (call === 1) throw new Error('statement timeout');
    },
  });
  const outcome = await claim.publish(job(800), signal(), far());
  await tailPlays();
  assert({
    given: 'an 800 ms phrase whose first floor read times out',
    should: 'read again next time and play the phrase whole',
    actual: {
      outcome,
      frames: handoffs.length,
      ends: ends.map((row) => row.end),
    },
    expected: {
      outcome: { complete: true, segmentEnded: false },
      frames: 80,
      ends: [{ kind: 'whole' }],
    },
  });
});

test('after a refused phrase start, nothing after it is authorized ahead of it', async () => {
  let refuseA = true;
  const { claim, begins } = harness({
    begin: async () => {
      const last = begins.at(-1) as { phrase: { phraseId: string } };
      if (last.phrase.phraseId[0] === 'a' && refuseA) {
        refuseA = false;
        throw createAppError('CONFLICT', 'floor lost');
      }
    },
  });
  const a = job(200, 'a'.repeat(24));
  const b = job(200, 'b'.repeat(24));
  // Joined ahead of speech, as the seat does: a phrase can be authorized ahead.
  claim.start();
  await Bun.sleep(10);
  const first = claim.publish(a, signal(), far());
  // As the speaker does: the next line is asked for as the current one starts.
  claim.writeAhead(b);
  await first.catch(() => undefined);
  await claim.publish(a, signal(), far());
  claim.writeAhead(b);
  await claim.publish(b, signal(), far());
  await tailPlays();
  assert({
    given:
      'a phrase whose start is refused once while the next was asked for ahead, then both said',
    should:
      'write the next line only after the refused phrase’s retry, keeping their order',
    actual: begins.map(
      (row) => (row as { phrase: { phraseId: string } }).phrase.phraseId[0],
    ),
    expected: ['a', 'a', 'b'],
  });
});

test('a stop that lands before a phrase’s audio silences the tail before it', async () => {
  const { claim, events } = harness();
  await claim.publish(job(400, 'a'.repeat(24)), signal(), far());
  // a's 300 ms tail is still queued when the next phrase is stopped.
  const controller = new AbortController();
  controller.abort();
  await assertRejects({
    given: 'a next phrase stopped before any of its audio',
    should: 'refuse it',
    actual: () =>
      claim.publish(job(400, 'b'.repeat(24)), controller.signal, far()),
    code: 'CONFLICT',
  });
  assert({
    given: 'the stop',
    should: 'clear the queued tail of the phrase before it at once',
    actual: events.includes('clear'),
    expected: true,
  });
  await claim.close();
});

test('a phrase start backing off after a failure writes nothing once the claim ends', async () => {
  let attempts = 0;
  const { claim } = harness({
    begin: async () => {
      attempts += 1;
      throw new Error('statement timeout');
    },
  });
  const publishing = claim
    .publish(job(100), signal(), far())
    .catch(() => 'stopped');
  await Bun.sleep(20);
  await claim.close();
  await publishing;
  await Bun.sleep(400);
  assert({
    given:
      'a phrase start that keeps timing out, its claim closed while it backs off',
    should: 'ask no more once the claim ended',
    actual: attempts,
    expected: 1,
  });
});

test('once the speech’s deadline is read, a phrase authorized ahead is timed on the database clock', async () => {
  const { claim, begins } = harness();
  claim.start();
  await Bun.sleep(10);
  await claim.deadline();
  const first = claim.publish(job(400, 'a'.repeat(24)), signal(), far());
  claim.writeAhead(job(400, 'b'.repeat(24)));
  await first;
  await tailPlays();
  await claim.close();
  const ahead = begins.find(
    (row) =>
      (row as { phrase: { phraseId: string } }).phrase.phraseId[0] === 'b',
  ) as { phrase: { startsAt?: string } };
  // The stub's database clock reads 1_000_000 ms; the line starts ~400 ms on.
  const startsAt = Date.parse(ahead.phrase.startsAt ?? '');
  assert({
    given:
      'a phrase authorized ahead after the speech read its database deadline',
    should:
      'carry when its audio starts on the database clock, fixed at the asking',
    actual: startsAt >= 1_000_000 && startsAt < 1_002_000,
    expected: true,
  });
});

test('each line is revealed as its audio starts: the next one just as the one before it finishes (ADR 0122)', async () => {
  const { claim, reveals, handoffs } = harness();
  claim.start();
  await Bun.sleep(10);
  const startAt = performance.now();
  const first = claim.publish(job(400, 'a'.repeat(24)), signal(), far());
  claim.writeAhead(job(400, 'b'.repeat(24)));
  await first;
  await claim.publish(job(400, 'b'.repeat(24)), signal(), far());
  await tailPlays();
  const at = (id: string) => reveals.find((row) => row.phraseId[0] === id)!.at;
  assert({
    given: 'two 400 ms phrases played back to back',
    should:
      'reveal the first as its audio starts, and the second 400 ms later, as the first finishes playing',
    actual: {
      firstAtStart: at('a') - startAt < 30,
      secondAtBoundary: Math.abs(at('b') - at('a') - 400) < 40,
      beforeAudio: handoffs.length > 0,
    },
    expected: { firstAtStart: true, secondAtBoundary: true, beforeAudio: true },
  });
});

test('a reveal refused as the audio starts stops the phrase at once', async () => {
  const lost = createAppError('CONFLICT', 'Bot speaking authority changed');
  const { claim, handoffs, ends } = harness({
    reveal: async () => {
      throw lost;
    },
  });
  const started = performance.now();
  await assertRejects({
    given: 'a one-second phrase whose floor is lost just as its audio starts',
    should: 'reject with the refusal',
    actual: () => claim.publish(job(1000), signal(), far()),
    code: 'CONFLICT',
  });
  assert({
    given: 'the refused reveal',
    should:
      'stop handing frames over within the lead, and close any line its reveal may have written at what played, nothing, so the phrase is said again as a new line',
    actual: {
      stoppedEarly: handoffs.every((at) => at - started < 400),
      ends: ends.map((row) => row.end),
      closed: claim.lineClosed(job(1000).phraseId),
    },
    expected: {
      stoppedEarly: true,
      ends: [{ kind: 'cut', spoken: '', playedMs: 0 }],
      closed: true,
    },
  });
});

test('a line end that keeps failing is asked again at the next phrase', async () => {
  let failing = 4;
  const ended: string[] = [];
  const { claim } = harness({
    end: async (phraseId) => {
      if (phraseId[0] === 'a' && failing > 0) {
        failing -= 1;
        throw new Error('connection reset');
      }
      ended.push(phraseId[0]!);
    },
  });
  await claim.publish(job(50, 'a'.repeat(24)), signal(), far());
  await tailPlays();
  await Bun.sleep(400);
  const afterFirst = [...ended];
  await claim.publish(job(50, 'b'.repeat(24)), signal(), far());
  await tailPlays();
  await claim.close();
  assert({
    given:
      'a line whose end fails past its retries, then the next phrase plays',
    should:
      'ask its end again at the next phrase, so no line is left unfinished',
    actual: { afterFirst, closed: ended.sort() },
    expected: { afterFirst: [], closed: ['a', 'b'] },
  });
});

test('a phrase shorter than the lead is revealed when its audio starts, not when it is handed over', async () => {
  const { claim, reveals } = harness();
  claim.start();
  await Bun.sleep(10);
  const first = claim.publish(job(600, 'a'.repeat(24)), signal(), far());
  claim.writeAhead(job(150, 'b'.repeat(24)));
  await first;
  await claim.publish(job(150, 'b'.repeat(24)), signal(), far());
  await tailPlays();
  const at = (id: string) => reveals.find((row) => row.phraseId[0] === id)!.at;
  assert({
    given:
      'a 600 ms phrase, then a 150 ms one handed over well before it plays',
    should: 'reveal the short one 600 ms after the first, as its audio starts',
    actual: Math.abs(at('b') - at('a') - 600) < 40,
    expected: true,
  });
});

test('a phrase whose handoff fails before its audio starts writes no line', async () => {
  let failFrom = Infinity;
  const { claim, reveals, ends } = harness({
    failHandoff: (frame) => frame >= failFrom,
  });
  claim.start();
  await Bun.sleep(10);
  await claim.publish(job(600, 'a'.repeat(24)), signal(), far());
  // a's 300 ms tail is still queued: b's first frame fails to hand over.
  failFrom = 0;
  const failed = await claim
    .publish(job(400, 'b'.repeat(24)), signal(), far())
    .then(
      () => 'played',
      () => 'failed',
    );
  await tailPlays();
  assert({
    given:
      'a phrase whose first frame fails to hand over while the tail before it still plays',
    should:
      'stop it, its audio dropped before it started, and reveal and close no line for it',
    actual: {
      failed,
      reveals: reveals.map((row) => row.phraseId[0]),
      ends: ends.map((row) => row.phraseId[0]),
    },
    expected: { failed: 'failed', reveals: ['a'], ends: ['a'] },
  });
});

test('a reveal retrying lands before the next phrase’s: lines are written in the order said', async () => {
  let failedOnce = false;
  const { claim, reveals } = harness({
    reveal: async (phraseId) => {
      if (phraseId[0] === 'a' && !failedOnce) {
        failedOnce = true;
        throw new Error('statement timeout');
      }
    },
  });
  claim.start();
  await Bun.sleep(10);
  // a is short: b's audio starts while a's reveal still backs off.
  const first = claim.publish(job(100, 'a'.repeat(24)), signal(), far());
  claim.writeAhead(job(400, 'b'.repeat(24)));
  await first;
  await claim.publish(job(400, 'b'.repeat(24)), signal(), far());
  await tailPlays();
  assert({
    given:
      'a 100 ms phrase whose reveal fails once and backs off past the next phrase’s audio start',
    should: 'write its line first, then the next one',
    actual: reveals.map((row) => row.phraseId[0]),
    expected: ['a', 'b'],
  });
});

test('a short phrase silenced before its audio starts writes no line', async () => {
  const { claim, reveals, ends } = harness();
  claim.start();
  await Bun.sleep(10);
  await claim.publish(job(400, 'a'.repeat(24)), signal(), far());
  // b is handed over whole behind a's queued tail, then a barge-in silences both.
  await claim.publish(job(150, 'b'.repeat(24)), signal(), far());
  claim.silence();
  await tailPlays();
  assert({
    given:
      'a 150 ms phrase handed over whole behind a queued tail, then silenced before its audio started',
    should: 'reveal and close no line for it',
    actual: {
      reveals: reveals.map((row) => row.phraseId[0]),
      ends: ends.map((row) => row.phraseId[0]),
    },
    expected: { reveals: ['a'], ends: ['a'] },
  });
});
