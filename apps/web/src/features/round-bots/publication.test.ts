import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, createRefusal } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createBotPublisher, type BotSpeechJob } from './publication';
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
type End = { phraseId: string; end: unknown };
/**
 * A claim's publisher in real time over a stub native track whose queue
 * plays out in real time, and a stub store. `begin` and `verify` decide each
 * phrase's start and floor reads.
 */
function harness(
  options: {
    readonly begin?: () => Promise<unknown>;
    readonly verify?: (call: number) => Promise<unknown>;
    readonly end?: () => Promise<unknown>;
  } = {},
) {
  const events: string[] = [];
  const handoffs: number[] = [];
  const ends: End[] = [];
  const begins: unknown[] = [];
  let joins = 0,
    verifies = 0;
  let playedUntil = 0;
  const publisher = createBotPublisher({
    store: {
      databaseNow: async () => new Date(1_000_000).toISOString(),
      verifyRoundBotPublication: async () => {
        const call = verifies++;
        await options.verify?.(call);
        return { segmentDueAt: new Date(1_060_000).toISOString() };
      },
      beginRoundBotPhrase: async (
        _scope: unknown,
        _token: unknown,
        phrase: unknown,
        room: unknown,
      ) => {
        begins.push({ phrase, room });
        await options.begin?.();
        return { duplicate: false, segmentDueAt: '' };
      },
      endRoundBotPhrase: async (
        _scope: unknown,
        _token: unknown,
        phraseId: string,
        end: unknown,
      ) => {
        await options.end?.();
        ends.push({ phraseId, end });
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
          const now = performance.now();
          handoffs.push(now);
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
    ends,
    begins,
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
    actual: { first, second, events, ends, begins },
    expected: {
      first: { complete: true, segmentEnded: false },
      second: { complete: true, segmentEnded: false },
      events: ['join:TR_0', 'clear', 'close:TR_0'],
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

test('the audio keeps its 10 ms cadence while the phrase start stalls 200 ms (ADR 0122)', async () => {
  const { claim, handoffs, ends } = harness({ begin: () => Bun.sleep(200) });
  const start = performance.now();
  const outcome = await claim.publish(job(400), signal(), far());
  await tailPlays();
  const duringStall = handoffs.filter((at) => at - start < 195).length;
  const gaps = handoffs.slice(1).map((at, index) => at - handoffs[index]!);
  assert({
    given: 'a 400 ms phrase whose authored line takes 200 ms to write',
    should:
      'hand frames over throughout the stall with no gap near 100 ms, and close the line whole',
    actual: {
      outcome,
      frames: handoffs.length,
      streamedDuringStall: duringStall >= 25,
      maxGapUnder60: Math.max(...gaps) < 60,
      ends: ends.map((row) => row.end),
    },
    expected: {
      outcome: { complete: true, segmentEnded: false },
      frames: 40,
      streamedDuringStall: true,
      maxGapUnder60: true,
      ends: [{ kind: 'whole' }],
    },
  });
});

test('a refused phrase start silences the audio at once and writes no line', async () => {
  const refusal = createRefusal('CONFLICT', 'bot-room-changed');
  let refusedAt = 0;
  const { claim, handoffs, ends, events } = harness({
    begin: async () => {
      if (refusedAt) return;
      await Bun.sleep(50);
      refusedAt = performance.now();
      throw refusal;
    },
  });
  await assertRejects({
    given: 'a phrase whose start is refused 50 ms in because the room changed',
    should: 'reject with that refusal',
    actual: () => claim.publish(job(1000), signal(), far()),
    code: 'CONFLICT',
  });
  const after = handoffs.filter((at) => at > refusedAt + 15).length;
  assert({
    given: 'the refused phrase',
    should:
      'stop handing frames over within a frame, clear the queue, and close no line',
    actual: { after, cleared: events.includes('clear'), ends },
    expected: { after: 0, cleared: true, ends: [] },
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
      'close it cut to a strict word prefix, about three-quarters of it, never whole',
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
      nextCut: 'cut',
    },
  });
});
