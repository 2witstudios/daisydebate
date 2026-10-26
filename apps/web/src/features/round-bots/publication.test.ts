import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { publicationStopOf } from '@daisy/media/audio';
import { createBotPublisher, type BotSpeechJob } from './publication';
setupRitewayBun();

const scope = {
  roundId: 'r'.repeat(24),
  roundParticipantId: 'p'.repeat(24),
  segmentId: 's'.repeat(24),
} as BotSpeechJob['scope'];
const job = (frames: number): BotSpeechJob => ({
  scope,
  token: 't',
  phraseId: 'f'.repeat(24),
  text: 'Phrase',
  pcm: new Int16Array(240 * frames).fill(1),
  sampleRate: 24000,
  channels: 1,
});
/**
 * A claim's publisher over stub native publications and an injected clock.
 * `events` orders every join, close, capture report and credited window;
 * `stalls` are the wakes (counted from 0) that return 150 ms late, as an
 * event-loop stall does; capture reports hearing a track `heardAfterMs` after
 * its join (never, when null), naming `heardSeat`.
 */
function harness(
  options: {
    readonly stalls?: readonly number[];
    readonly join?: (attempt: number) => Promise<void>;
    readonly heardAfterMs?: number | null;
    readonly heardSeat?: string;
  } = {},
) {
  let now = 1_000,
    wakes = 0,
    joins = 0;
  const events: string[] = [];
  const open: { sid: string; closed: boolean; failed: boolean }[] = [];
  const joinedAt = new Map<string, number>();
  const heard = new Set<string>();
  const publisher = createBotPublisher({
    store: {
      databaseNow: async () => new Date(1_792_000_000_000 + now).toISOString(),
      verifyRoundBotPublication: async (
        _scope: unknown,
        _token: unknown,
        window?: unknown,
      ) => {
        if (window) events.push('credit');
      },
    } as never,
    botToken: async () => ({ url: 'ws://media.test', token: 'grant' }),
    connect: async () => {
      const attempt = joins++;
      await options.join?.(attempt);
      const state = { sid: `TR_${attempt}`, closed: false, failed: false };
      open.push(state);
      joinedAt.set(state.sid, now);
      events.push(`join:${state.sid}`);
      let samples = 0;
      return {
        trackSid: state.sid,
        usable: () => !state.closed && !state.failed,
        sentSamples: () => samples,
        capture10ms: async (frame: Int16Array) => {
          if (samples === 0) events.push(`send:${state.sid}`);
          const beforeMs = now;
          now += 1;
          const startSample = samples;
          samples += frame.length;
          return { startSample, endSample: samples, beforeMs, afterMs: now };
        },
        close: async () => {
          if (!state.closed) events.push(`close:${state.sid}`);
          state.closed = true;
          return { consumedSamples: samples };
        },
      } as never;
    },
    heard: async (roundId: string, trackSid: string) => {
      const after =
        options.heardAfterMs === undefined ? 0 : options.heardAfterMs;
      if (
        roundId !== scope.roundId ||
        after === null ||
        now < joinedAt.get(trackSid)! + after
      )
        return null;
      if (!heard.has(trackSid)) events.push(`heard:${trackSid}`);
      heard.add(trackSid);
      return options.heardSeat ?? scope.roundParticipantId;
    },
    nextId: () => 'k'.repeat(24),
    monotonicNowMs: () => now,
    waitUntilMs: async (due) => {
      now = Math.max(now, due) + (options.stalls?.includes(wakes) ? 150 : 0);
      wakes += 1;
    },
  });
  return { claim: publisher({ scope, token: 't' }), events, open };
}
const signal = () => new AbortController().signal;

test('a retry after a stalled attempt is heard on the same track (ISSUE-514-r1)', async () => {
  const { claim, events } = harness({ stalls: [5, 6] });
  claim.start();
  const first = await claim.publish(job(25), signal());
  const second = await claim.publish(job(20), signal());
  assert({
    given:
      'a claim whose first attempt stalls twice and stops, then a retry of the rest',
    should:
      'join once before any credit, stop the first with a stall, and send the retry whole on the same track',
    actual: {
      first: [first.complete, first.stop],
      second: [second.complete, second.eligibleSamples],
      joins: events.filter((event) => event.startsWith('join')),
      firstEvent: events[0],
      closes: events.filter((event) => event.startsWith('close')),
    },
    expected: {
      first: [false, 'stall'],
      second: [true, 4800],
      joins: ['join:TR_0'],
      firstEvent: 'join:TR_0',
      closes: [],
    },
  });
});

test('the publication ends with its claim, and a closed claim publishes nothing', async () => {
  const { claim, events, open } = harness();
  claim.start();
  await claim.publish(job(10), signal());
  await claim.close();
  await assertRejects({
    given: 'a publish after the claim ended',
    should: 'be refused as changed authority, joining nothing',
    actual: () => claim.publish(job(10), signal()),
    code: 'CONFLICT',
  });
  assert({
    given: 'a claim that spoke and then ended',
    should: 'leave no participant joined',
    actual: [open.map((state) => state.closed), events.at(-1)],
    expected: [[true], 'close:TR_0'],
  });
});

test('a claim that ends while it is still joining leaves no participant behind', async () => {
  const joined = Promise.withResolvers<void>();
  const { claim, open } = harness({ join: () => joined.promise });
  claim.start();
  const closing = claim.close();
  joined.resolve();
  await closing;
  assert({
    given: 'a claim ended before its early join returned',
    should: 'close the publication once it is joined',
    actual: open.map((state) => state.closed),
    expected: [true],
  });
});

test('a failed join or a failed publication is replaced on the next use, and the old one released', async () => {
  const { claim, events, open } = harness({
    join: async (attempt) => {
      if (attempt === 0) throw new Error('connect failed');
    },
  });
  claim.start();
  const afterFailedJoin = await claim.publish(job(10), signal());
  open[0]!.failed = true;
  const afterFailedHandoff = await claim.publish(job(10), signal());
  await claim.close();
  assert({
    given:
      'an early join that failed, then a publication whose native handoff failed',
    should:
      'join again for the first attempt, replace the failed track for the next, and release both',
    actual: {
      complete: [afterFailedJoin.complete, afterFailedHandoff.complete],
      tracks: events.filter((event) => /^(join|close)/.test(event)),
      closed: open.map((state) => state.closed),
    },
    expected: {
      complete: [true, true],
      tracks: ['join:TR_1', 'close:TR_1', 'join:TR_2', 'close:TR_2'],
      closed: [true, true],
    },
  });
});

test('nothing is spoken or credited before capture reports hearing the track (ISSUE-514-r2)', async () => {
  const { claim, events } = harness({ heardAfterMs: 300 });
  claim.start();
  const result = await claim.publish(job(10), signal());
  assert({
    given: 'a joined track that capture reports hearing 300 ms after its join',
    should:
      'send no frame and credit no window until the report, then send the phrase whole',
    actual: {
      order: events.filter((event) => event !== 'credit'),
      firstCredit: events.indexOf('credit') > events.indexOf('heard:TR_0'),
      complete: [result.complete, result.eligibleSamples],
    },
    expected: {
      order: ['join:TR_0', 'heard:TR_0', 'send:TR_0'],
      firstCredit: true,
      complete: [true, 2400],
    },
  });
});

test('a track capture never hears fails honestly, credits nothing and is released', async () => {
  const { claim, events, open } = harness({ heardAfterMs: null });
  claim.start();
  const error = await claim.publish(job(10), signal()).catch((e) => e);
  await claim.close();
  assert({
    given: 'a claim whose tracks capture never reports hearing',
    should:
      'stop the publish as unheard after its bound, speak and credit nothing and leave no participant joined',
    actual: {
      stop: publicationStopOf(error),
      credits: events.filter((event) => /^(credit|send)/.test(event)).length,
      closed: open.map((state) => state.closed),
    },
    expected: { stop: 'unheard', credits: 0, closed: [true, true] },
  });
});

test('a report that capture heard the track for another seat is not this seat being heard', async () => {
  const { claim, events } = harness({ heardSeat: 'o'.repeat(24) });
  claim.start();
  const error = await claim.publish(job(10), signal()).catch((e) => e);
  await claim.close();
  assert({
    given: "a capture report naming a different seat for the bot's track",
    should: 'never credit the bot and stop as unheard',
    actual: [publicationStopOf(error), events.includes('credit')],
    expected: ['unheard', false],
  });
});

test('a claim that ends while its track waits to be heard leaves no participant behind', async () => {
  const joined = Promise.withResolvers<void>();
  const { claim, open, events } = harness({
    heardAfterMs: null,
    join: () => joined.promise,
  });
  claim.start();
  joined.resolve();
  await Promise.resolve();
  await claim.close();
  assert({
    given: 'a claim ended while capture has not yet heard its joined track',
    should: 'abandon the wait and close the publication, crediting nothing',
    actual: [open.map((state) => state.closed), events.includes('credit')],
    expected: [[true], false],
  });
});
