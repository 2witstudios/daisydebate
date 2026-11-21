import { instantMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { virtualClock } from '@daisy/clock/testing';
import { createPeerLineWait } from './peer-line';
import { scope } from './speaker.test-support';

setupRitewayBun();

/** A wait over a transcript in which the peer's line appears at `landsAtMs`. */
function waiting(
  landsAtMs: number,
  mode: 'reads' | 'fails' | 'hangs' = 'reads',
) {
  const clock = virtualClock();
  const reads: string[] = [];
  const outcomes: string[] = [];
  const wait = createPeerLineWait({
    claim: { scope, token: 'memory-only' },
    readPeerLine: async (_scope, _token, peers, since) => {
      reads.push(`${peers.join()}@${instantMs(since)}`);
      if (mode === 'fails') throw new Error('pool refused');
      if (mode === 'hangs') await new Promise(() => undefined);
      return clock.nowMs() >= landsAtMs;
    },
    sleep: clock.sleep,
    monotonicNowMs: clock.nowMs,
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
      'read for that peer at the instant they last spoke, every 150 ms, until its line is there, and trace the wait with its Round',
    actual: [landed.reads[0], landed.reads.length, landed.outcomes],
    expected: ['peer@100000', 5, ['line.line:600:round']],
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
  const clock = virtualClock();
  const wait = createPeerLineWait({
    claim: { scope, token: 'memory-only' },
    readPeerLine: async () => true,
    sleep: clock.sleep,
    monotonicNowMs: clock.nowMs,
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
