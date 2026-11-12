import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPeerLineWait } from './peer-line';
import { scope } from './speaker.test-support';

setupRitewayBun();

/**
 * A clock the test owns: a sleep ends only when `run` advances time to it,
 * soonest first, after everything already due has settled.
 */
function testClock() {
  let now = 0;
  const sleeps: { at: number; wake: () => void }[] = [];
  const settled = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    now: () => now,
    sleep: (ms: number) =>
      new Promise<void>((wake) => {
        sleeps.push({ at: now + ms, wake });
      }),
    /** Runs `work` to its end, advancing time whenever it is only waiting. */
    run: async (work: Promise<void>) => {
      let done = false;
      void work.then(() => {
        done = true;
      });
      for (await settled(); !done; await settled()) {
        sleeps.sort((a, b) => a.at - b.at);
        const next = sleeps.shift();
        if (!next) throw new Error('the wait is stuck with nothing to wake it');
        now = next.at;
        next.wake();
      }
    },
  };
}
/** A wait over a transcript in which the peer's line appears at `landsAtMs`. */
function waiting(
  landsAtMs: number,
  mode: 'reads' | 'fails' | 'hangs' = 'reads',
) {
  const clock = testClock();
  const reads: string[] = [];
  const outcomes: string[] = [];
  const wait = createPeerLineWait({
    claim: { scope, token: 'memory-only' },
    readPeerLine: async (_scope, _token, peers, since) => {
      reads.push(`${peers.join()}@${Date.parse(since)}`);
      if (mode === 'fails') throw new Error('pool refused');
      if (mode === 'hangs') await new Promise(() => undefined);
      return clock.now() >= landsAtMs;
    },
    sleep: (ms, signal) =>
      signal.aborted ? Promise.resolve() : clock.sleep(ms),
    monotonicNowMs: clock.now,
    observed: (operation, fields) =>
      outcomes.push(`${operation}:${fields.durationMs}:${fields.roundId}`),
  });
  return {
    wait: (signal = new AbortController().signal) =>
      clock.run(wait('peer', 100_000, signal)),
    reads,
    outcomes,
  };
}

test('a cross-examination answer waits for the peer’s line, up to a cap', async () => {
  const landed = waiting(600);
  await landed.wait();
  assert({
    given:
      'a peer line that reaches the transcript 600 ms after the turn ended',
    should:
      'read for that peer from 450 ms before the instant they last spoke, every 150 ms, until it is there, and trace the wait with its Round',
    actual: [landed.reads[0], landed.reads.length, landed.outcomes],
    expected: ['peer@99550', 5, ['line.line:600:round']],
  });
  const never = waiting(Infinity);
  await never.wait();
  const hung = waiting(0, 'hangs');
  await hung.wait();
  assert({
    given: 'a peer line that never arrives, and a transcript read that hangs',
    should:
      'end both waits within four seconds (the last read that fits, then the deadline) and let the answer go ahead',
    actual: [never.outcomes, hung.outcomes, hung.reads.length],
    expected: [['line.cap:3900:round'], ['line.cap:4000:round'], 1],
  });
});

test('a failing read is asked again; a dropped turn or a failing trace fails nothing', async () => {
  const unread = waiting(Infinity, 'fails');
  await unread.wait();
  const dropped = waiting(Infinity);
  await dropped.wait(AbortSignal.abort());
  assert({
    given: 'reads that are always refused, and a turn already aborted',
    should:
      'keep reading to the cap for the first, and read nothing for the second',
    actual: [unread.outcomes, unread.reads.length > 20, dropped.reads.length],
    expected: [['line.cap:3900:round'], true, 0],
  });
  const clock = testClock();
  const wait = createPeerLineWait({
    claim: { scope, token: 'memory-only' },
    readPeerLine: async () => true,
    sleep: clock.sleep,
    monotonicNowMs: clock.now,
    observed: () => {
      throw new Error('logger down');
    },
  });
  assert({
    given: 'a trace that throws',
    should: 'still resolve the wait',
    actual: await wait('peer', 1, new AbortController().signal).then(
      () => 'resolved',
      () => 'rejected',
    ),
    expected: 'resolved',
  });
});
