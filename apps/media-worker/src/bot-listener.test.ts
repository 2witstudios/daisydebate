import { assert, setupRitewayBun, test } from 'riteway/bun';
import { keepListening, runBotListener } from './bot-listener';
import { createPeerAudioTap } from './peer-audio';
setupRitewayBun();

const human = 'h'.repeat(24),
  bot = 'b'.repeat(24),
  segmentId = 'g'.repeat(24);
const T0 = Date.parse('2026-10-27T12:00:00.000Z');

/** A listener run over a fake client and clock; `frames` arrive at each wait. */
async function run(segmentType: 'cross_ex' | 'speech', waits = 6) {
  const calls: { op: string; arg: unknown }[] = [];
  let t = 1000;
  const tap = createPeerAudioTap();
  let sequence = 0;
  const controller = new AbortController();
  const client = {
    lease: async (leaseMs: number, _s?: AbortSignal, expected?: number) => {
      calls.push({ op: 'lease', arg: expected ?? null });
      return { epoch: 3, expiresAt: new Date(T0 + leaseMs).toISOString() };
    },
    read: async (epoch: number) => {
      calls.push({ op: 'read', arg: epoch });
      return {
        state: {
          roundId: 'r'.repeat(24),
          sessionId: 's'.repeat(24),
          serverNow: new Date(T0 + t).toISOString(),
          segment: { id: segmentId, type: segmentType, endedAt: null },
          participants: [
            {
              roundParticipantId: human,
              kind: 'human' as const,
              identity: 'hid',
            },
            { roundParticipantId: bot, kind: 'bot' as const, identity: 'bid' },
          ],
        },
        calibration: {
          sentAtMs: t - 1,
          receivedAtMs: t,
          serverNowMs: T0 + t,
          precisionMs: 1,
        },
      };
    },
    activity: async (batch: {
      epoch: number;
      roundParticipantId: string;
      segmentId: string;
    }) => {
      calls.push({ op: 'activity', arg: batch });
    },
  };
  let waited = 0;
  const result = await runBotListener(
    {
      client: client as never,
      audio: tap,
      nowMs: () => t,
      waitUntilMs: async (due) => {
        for (let i = 0; i < 5; i++) {
          sequence += 1;
          tap.publish({
            identity: 'hid',
            trackId: 'TR_h',
            sequence,
            pcm: new Int16Array(160).fill(9),
            beforeMs: t + i * 10,
            afterMs: t + i * 10 + 1,
          });
        }
        t = due;
        if (++waited >= waits) controller.abort();
      },
    },
    controller.signal,
  );
  return { calls, result };
}

test('in a bot cross-ex the listener relays a peer seat under its own lease epoch (ISSUE-764)', async () => {
  const { calls, result } = await run('cross_ex');
  const batches = calls
    .filter((c) => c.op === 'activity')
    .map(
      (c) =>
        c.arg as {
          epoch: number;
          roundParticipantId: string;
          segmentId: string;
        },
    );
  assert({
    given: 'a bot cross-examination with a human peer speaking',
    should:
      'claim its lease, then relay that seat under its own epoch and the open segment',
    actual: {
      first: calls[0],
      seats: [
        ...new Set(
          batches.map(
            (b) => `${b.epoch}:${b.roundParticipantId}:${b.segmentId}`,
          ),
        ),
      ],
      relayed: result.relayedBatches > 0,
    },
    expected: {
      first: { op: 'lease', arg: null },
      seats: [`3:${human}:${segmentId}`],
      relayed: true,
    },
  });
});

test('outside a bot cross-ex the listener relays nothing', async () => {
  const { calls, result } = await run('speech');
  assert({
    given: 'a speech segment with the same peer audio',
    should: 'hear it but relay no activity',
    actual: [
      calls.filter((c) => c.op === 'activity').length,
      result.relayedBatches,
    ],
    expected: [0, 0],
  });
});

test('the listener renews its own lease at its epoch', async () => {
  const { calls } = await run('speech', 120);
  assert({
    given: 'a listener running past its renewal interval',
    should: 'renew with its own epoch as the expected one',
    actual: calls.some((c) => c.op === 'lease' && c.arg === 3),
    expected: true,
  });
});

test('a listener failure re-claims and resumes until capture stops (ISSUE-764)', async () => {
  const controller = new AbortController();
  let leases = 0;
  const waits: number[] = [];
  await keepListening(
    {
      run: async () => {
        leases += 1;
        if (leases < 3) throw new Error('lease is held');
        controller.abort();
        return { relayedBatches: 0 };
      },
      nowMs: () => 0,
      waitUntilMs: async (due) => {
        waits.push(due);
      },
    },
    controller.signal,
  );
  assert({
    given: 'a listener that fails twice, then runs until capture stops',
    should: 'pause and re-claim after each failure, and stop with capture',
    actual: [leases, waits],
    expected: [3, [1000, 1000]],
  });
});
