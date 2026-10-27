import { assert, setupRitewayBun, test } from 'riteway/bun';
import { keepListening, runBotListener } from './bot-listener';
import { createPeerAudioTap } from './peer-audio';
setupRitewayBun();

const human = 'h'.repeat(24),
  bot = 'b'.repeat(24),
  segmentId = 'g'.repeat(24);
const T0 = Date.parse('2026-10-27T12:00:00.000Z');

/**
 * A listener run over a fake client and clock. Local time `t` maps to server
 * time T0 + t; five 10 ms frames of the human seat arrive at each wait.
 */
async function run(options: {
  readonly segmentType: 'cross_ex' | 'speech';
  readonly botSeat?: boolean;
  readonly humanHasFloor?: boolean;
  readonly waits?: number;
}) {
  const { segmentType, botSeat = true, humanHasFloor = true } = options;
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
          segment: {
            id: segmentId,
            type: segmentType,
            startedAt: new Date(T0).toISOString(),
            durationMs: 600_000,
          },
          participants: [
            {
              roundParticipantId: human,
              kind: 'human' as const,
              identity: 'hid',
            },
            ...(botSeat
              ? [
                  {
                    roundParticipantId: bot,
                    kind: 'bot' as const,
                    identity: 'bid',
                  },
                ]
              : []),
          ],
          intervals: humanHasFloor
            ? [
                {
                  roundParticipantId: human,
                  startedAt: new Date(T0).toISOString(),
                  endedAt: null,
                },
              ]
            : [],
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
        if (++waited >= (options.waits ?? 6)) controller.abort();
      },
    },
    controller.signal,
  );
  const count = (op: string) => calls.filter((c) => c.op === op).length;
  return { calls, result, count };
}

test('in a bot cross-ex the listener relays a peer seat holding the floor, under its own lease epoch (ISSUE-764)', async () => {
  const { calls, result } = await run({ segmentType: 'cross_ex' });
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
    given: 'a bot cross-examination with a human peer speaking on the floor',
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

test('a seat without the floor is never relayed, as capture never keeps it', async () => {
  const { count } = await run({
    segmentType: 'cross_ex',
    humanHasFloor: false,
  });
  assert({
    given: 'a bot cross-ex whose speaking peer holds no speaking grant',
    should: 'relay none of its frames',
    actual: count('activity'),
    expected: 0,
  });
});

test('outside a bot cross-ex the listener relays nothing and reads slowly', async () => {
  const speech = await run({ segmentType: 'speech', waits: 40 });
  const crossEx = await run({ segmentType: 'cross_ex', waits: 40 });
  assert({
    given:
      'two seconds of a speech segment, then of a cross-ex, with the same peer audio',
    should:
      'relay nothing in the speech and read about once a second there, five times as often in cross-ex',
    actual: {
      activity: speech.count('activity'),
      slow: speech.count('read') <= 3,
      fast: crossEx.count('read') >= 9,
    },
    expected: { activity: 0, slow: true, fast: true },
  });
});

test('a Round with no bot debater leaves the listener idle after one read', async () => {
  const { calls, result } = await run({
    segmentType: 'cross_ex',
    botSeat: false,
  });
  assert({
    given: 'a frozen cast with no bot debater',
    should: 'claim, read once and go idle for the session, relaying nothing',
    actual: [calls.map((c) => c.op), result],
    expected: [['lease', 'read'], { relayedBatches: 0, idle: true }],
  });
});

test('the listener renews its own lease at its epoch', async () => {
  const { calls } = await run({ segmentType: 'speech', waits: 120 });
  assert({
    given: 'a listener running past its renewal interval',
    should: 'renew with its own epoch as the expected one',
    actual: calls.some((c) => c.op === 'lease' && c.arg === 3),
    expected: true,
  });
});

test('failures back off and re-claim, and an idle listener stops for good (ISSUE-764)', async () => {
  const controller = new AbortController();
  let runs = 0;
  const waits: number[] = [];
  await keepListening(
    {
      run: async () => {
        runs += 1;
        if (runs < 4) throw new Error('lease is held');
        return { relayedBatches: 0, idle: true };
      },
      nowMs: () => 0,
      waitUntilMs: async (due) => {
        waits.push(due);
      },
    },
    controller.signal,
  );
  assert({
    given: 'a listener that fails three times, then finds no bot debater',
    should: 'pause 1, 2 then 4 s before each re-claim, then stop',
    actual: [runs, waits],
    expected: [4, [1000, 2000, 4000]],
  });
});
