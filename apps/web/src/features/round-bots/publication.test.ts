import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
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
 * `events` orders every join, close and credited window; `stalls` are the
 * wakes (counted from 0) that return 150 ms late, as an event-loop stall does.
 */
function harness(
  options: {
    readonly stalls?: readonly number[];
    readonly join?: (attempt: number) => Promise<void>;
  } = {},
) {
  let now = 1_000,
    wakes = 0,
    joins = 0;
  const events: string[] = [];
  const open: { sid: string; closed: boolean; failed: boolean }[] = [];
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
      events.push(`join:${state.sid}`);
      let samples = 0;
      return {
        usable: () => !state.closed && !state.failed,
        sentSamples: () => samples,
        capture10ms: async (frame: Int16Array) => {
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
