import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { readCaptureHistory, type CaptureClient } from './capture-history';
setupRitewayBun();

test('a history deadline restarts acquisition without mixing partial snapshot pages', async () => {
  const deadline = new AbortController();
  const requests: unknown[] = [];
  const oldInterval = {
    id: 'old',
    roundParticipantId: 'seat',
    startedAt: new Date(0).toISOString(),
    endedAt: null,
    startedVersion: 1,
    endedVersion: null,
  };
  const freshInterval = { ...oldInterval, id: 'fresh' };
  let count = 0;
  const client: Pick<CaptureClient, 'read'> = {
    read: async (request: unknown) => {
      requests.push(request);
      count++;
      if (count === 2) {
        deadline.abort();
        throw createAppError('CONFLICT', 'Media control was cancelled');
      }
      return {
        state: {
          roundId: 'round',
          sessionId: 'session',
          status: 'active',
          serverNow: new Date(0).toISOString(),
          transcriptAdmissionCutoff: null,
          participants: [],
          version: count === 1 ? 1 : 2,
          segment: {
            id: 'segment',
            sequence: 0,
            type: 'speech',
            startedAt: new Date(0).toISOString(),
            endedAt: null,
            durationMs: 60000,
          },
          intervals: [count === 1 ? oldInterval : freshInterval],
          nextIntervalId: count === 1 ? 'next' : null,
        },
        calibration: {
          sentAtMs: 0,
          receivedAtMs: 0,
          serverNowMs: 0,
          precisionMs: 1,
        },
      };
    },
  };
  let attempts = 0;
  const result = await readCaptureHistory(
    client,
    1,
    new AbortController().signal,
    undefined,
    {
      deadlineSignal: () =>
        ++attempts === 1 ? deadline.signal : new AbortController().signal,
    },
  );
  assert({
    given: 'a paged history acquisition that exceeds its own deadline',
    should: 'retry from page one and retain only one complete fresh snapshot',
    actual: {
      requests,
      intervals: result.state.intervals,
      version: result.state.version,
    },
    expected: {
      requests: [
        { epoch: 1 },
        {
          epoch: 1,
          segmentId: 'segment',
          expectedVersion: 1,
          afterIntervalId: 'next',
        },
        { epoch: 1 },
      ],
      intervals: [freshInterval],
      version: 2,
    },
  });
});
