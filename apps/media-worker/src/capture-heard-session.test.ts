import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { CaptureClient, CaptureState } from './capture-history';
import { runCaptureSession } from './capture-session';
setupRitewayBun();

test('a stalled heard report cannot hold capture history, validation or sealing (ISSUE-522)', async () => {
  const caller = new AbortController();
  const heardStarted = Promise.withResolvers<void>();
  const sealed = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<'closed'>();
  let reads = 0,
    reports = 0,
    now = 0;
  const cancelWait = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    });
  const snapshot = () => {
    const ended = reads > 2;
    return {
      state: {
        roundId: 'r'.repeat(24),
        status: 'active',
        version: 2,
        serverNow: new Date(ended ? 2000 : 500).toISOString(),
        segment: {
          id: 's'.repeat(24),
          type: 'speech',
          startedAt: new Date(0).toISOString(),
          endedAt: ended ? new Date(1000).toISOString() : null,
          durationMs: 1000,
        },
        participants: [
          { roundParticipantId: 'p'.repeat(24), kind: 'bot', identity: 'bot' },
        ],
        intervals: [
          {
            roundParticipantId: 'p'.repeat(24),
            startedAt: new Date(0).toISOString(),
            endedAt: ended ? new Date(1000).toISOString() : null,
          },
        ],
      } as unknown as CaptureState,
      calibration: {
        sentAtMs: now,
        receivedAtMs: now,
        serverNowMs: ended ? 2000 : 500,
        precisionMs: 1,
      },
    };
  };
  const client = {
    lease: async () => ({ epoch: 1 }),
    token: async () => ({ url: 'wss://media.invalid', token: 'test' }),
    read: async () => {
      reads++;
      return snapshot();
    },
    heard: async (_track: unknown, signal: AbortSignal) => {
      reports++;
      heardStarted.resolve();
      await cancelWait(signal);
    },
    activity: async () => {},
    seal: async () => {
      sealed.resolve();
      return {};
    },
  } as unknown as CaptureClient;
  const running = runCaptureSession(
    {
      roundId: 'r'.repeat(24),
      client,
      voice: { transcribe: async () => '' } as never,
      sttModel: 'test',
      nowMs: () => now,
      waitUntilMs: async (due, signal) => {
        if (due === 250 && reads === 2) {
          await heardStarted.promise;
          now = 250;
          return;
        }
        await cancelWait(signal);
      },
      subscribe: async (setup) => {
        setup.onTrackStarted?.({ identity: 'bot', trackId: 'track' });
        return {
          closed: closed.promise,
          setIdentities: async () => {},
          close: async () => {
            closed.resolve('closed');
          },
        } as never;
      },
      consume: async ({ signal }) => cancelWait(signal),
    },
    caller.signal,
  );
  try {
    await sealed.promise;
    assert({
      given: 'a bot heard call still pending while the segment closes',
      should:
        'continue through the next history and seal without another concurrent report',
      actual: [reads, reports],
      expected: [3, 1],
    });
  } finally {
    caller.abort();
    await running;
  }
});
