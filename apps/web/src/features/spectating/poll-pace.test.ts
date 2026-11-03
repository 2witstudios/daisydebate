import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  POLL_MS,
  POLL_MAX_MS,
  answerOfResponse,
  nextPollDelayMs,
  startPacedPoll,
  type PollAnswer,
} from './poll-pace';

setupRitewayBun();

const middle = () => 0.5;
const answered: PollAnswer = { kind: 'answered' };
const refused = (retryAfterMs: number | null): PollAnswer => ({
  kind: 'refused',
  retryAfterMs,
});

describe('nextPollDelayMs', () => {
  test('an answer keeps the ordinary pace', () => {
    assert({
      given: 'an answered read, at the middle of the spread',
      should: 'wait the polling interval and forget earlier refusals',
      actual: nextPollDelayMs(5, answered, middle),
      expected: { misses: 0, delayMs: POLL_MS },
    });
  });

  test('viewers do not poll in step', () => {
    const delays = [0, 1].map(
      (unit) => nextPollDelayMs(0, answered, () => unit).delayMs,
    );
    assert({
      given: 'the two ends of the spread',
      should: 'spread the interval either side of it',
      actual: delays[0]! < POLL_MS && delays[1]! > POLL_MS,
      expected: true,
    });
  });

  test('each miss backs off further, up to a limit', () => {
    assert({
      given: 'one, two and many misses in a row',
      should: 'double each time and never pass the limit',
      actual: [0, 1, 20].map(
        (misses) => nextPollDelayMs(misses, { kind: 'failed' }, middle).delayMs,
      ),
      expected: [2 * POLL_MS, 4 * POLL_MS, POLL_MAX_MS],
    });
  });

  test('a refusal never comes back sooner than it asked', () => {
    assert({
      given: 'a Retry-After past the backoff, at the low end of the spread',
      should: 'wait at least that long',
      actual: nextPollDelayMs(0, refused(20_000), () => 0).delayMs >= 20_000,
      expected: true,
    });
  });
});

describe('answerOfResponse', () => {
  test('what a response says about polling', () => {
    assert({
      given: 'a 200, a 503 asking for 3 seconds, a 429 and a bare 500',
      should: 'read an answer, two refusals and a failure',
      actual: [
        answerOfResponse(new Response('{}')),
        answerOfResponse(
          new Response(null, {
            status: 503,
            headers: { 'Retry-After': '3' },
          }),
        ),
        answerOfResponse(new Response(null, { status: 429 })),
        answerOfResponse(new Response(null, { status: 500 })),
      ],
      expected: [
        { kind: 'answered' },
        { kind: 'refused', retryAfterMs: 3000 },
        { kind: 'refused', retryAfterMs: null },
        { kind: 'failed' },
      ],
    });
  });
});

describe('startPacedPoll', () => {
  const world = (answers: PollAnswer[]) => {
    const waits: number[] = [];
    let fire: (() => void) | null = null;
    let cancelled = 0;
    let reads = 0;
    const stop = startPacedPoll({
      read: async () => {
        reads += 1;
        return answers.shift() ?? answered;
      },
      spread: middle,
      schedule: (ms, run) => {
        waits.push(ms);
        fire = run;
        return () => {
          cancelled += 1;
        };
      },
    });
    return {
      stop,
      waits,
      reads: () => reads,
      cancelled: () => cancelled,
      tick: async () => {
        const run = fire!;
        fire = null;
        run();
        await Bun.sleep(0);
      },
      pending: () => fire !== null,
    };
  };

  test('it waits before its first read, and paces each by the last answer', async () => {
    const poll = world([{ kind: 'failed' }, { kind: 'failed' }, answered]);
    const first = [poll.reads(), poll.waits[0]];
    await poll.tick();
    await poll.tick();
    await poll.tick();
    assert({
      given: 'two misses and then an answer',
      should: 'back off twice and then return to the ordinary pace',
      actual: [first, poll.waits.slice(1)],
      expected: [
        [0, POLL_MS],
        [2 * POLL_MS, 4 * POLL_MS, POLL_MS],
      ],
    });
    poll.stop();
  });

  test('a stopped poll reads no more and schedules nothing', async () => {
    const poll = world([]);
    await poll.tick();
    poll.stop();
    assert({
      given: 'a stop while a wait is pending',
      should: 'cancel the wait',
      actual: [poll.cancelled(), poll.reads()],
      expected: [1, 1],
    });
  });
});
