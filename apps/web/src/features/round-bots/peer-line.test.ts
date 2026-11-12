import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPeerLineWait } from './peer-line';
import { scope } from './speaker.test-support';

setupRitewayBun();

/** A wait over a transcript in which the peer's line appears at `landsAtMs`. */
function waiting(landsAtMs: number, fails = false) {
  let now = 0;
  const reads: string[] = [];
  const outcomes: string[] = [];
  const wait = createPeerLineWait({
    claim: { scope, token: 'memory-only', peerParticipantIds: ['peer'] },
    readPeerLine: async (_scope, _token, peers, since) => {
      reads.push(`${peers.join()}@${Date.parse(since)}`);
      if (fails) throw new Error('pool refused');
      return now >= landsAtMs;
    },
    sleep: async (ms) => {
      now += ms;
    },
    monotonicNowMs: () => now,
    waited: (outcome, ms) => outcomes.push(`${outcome}:${ms}`),
  });
  return { wait, reads, outcomes, now: () => now };
}

test('a cross-examination answer waits for the peer’s line, up to a cap', async () => {
  const landed = waiting(600);
  await landed.wait(100_000, new AbortController().signal);
  assert({
    given:
      'a peer line that reaches the transcript 600 ms after the turn ended',
    should:
      'read for that peer from just before the instant they last spoke, every 150 ms, until it is there',
    actual: [landed.reads[0], landed.reads.length, landed.outcomes],
    expected: ['peer@99500', 5, ['line:600']],
  });
  const never = waiting(Infinity);
  await never.wait(100_000, new AbortController().signal);
  assert({
    given: 'a peer line that never arrives',
    should: 'stop at four seconds and let the answer go ahead',
    actual: [never.now() <= 4000, never.outcomes[0]?.split(':')[0]],
    expected: [true, 'cap'],
  });
});

test('a wait that cannot read, or whose turn was dropped, ends without failing the turn', async () => {
  const unread = waiting(0, true);
  await unread.wait(1, new AbortController().signal);
  const dropped = waiting(Infinity);
  await dropped.wait(1, AbortSignal.abort());
  assert({
    given: 'a refused read, and a turn already aborted',
    should: 'resolve both, reading once and not at all',
    actual: [unread.outcomes, unread.reads.length, dropped.reads.length],
    expected: [['unread:0'], 1, 0],
  });
});
