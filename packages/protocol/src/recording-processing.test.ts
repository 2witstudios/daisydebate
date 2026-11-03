import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  recordingBuildDelayed,
  recordingPreparationOf,
  recordingProcessingBoundMs,
} from './recording-processing';

setupRitewayBun();

const MINUTE = 60_000;
const endedAtMs = Date.parse('2026-11-03T12:00:00.000Z');
const capture = {
  source: { kind: 'own_capture' as const },
  startedAt: new Date(endedAtMs - 80 * MINUTE).toISOString(),
  attempts: [
    {
      attempt: 1,
      egressId: 'EG',
      startedAt: new Date(endedAtMs - 80 * MINUTE).toISOString(),
    },
  ],
  endedAt: new Date(endedAtMs).toISOString(),
};
const processing = { status: 'processing', capture } as const;
const progress = { step: 'encoding', done: 1000, total: 2000 } as const;

describe('recordingProcessingBoundMs', () => {
  test('is half the media plus five minutes', () => {
    assert({
      given: 'an 80 minute video and a very short one',
      should: 'allow 45 minutes, and a little over five',
      actual: [
        recordingProcessingBoundMs(80 * MINUTE),
        recordingProcessingBoundMs(1000),
      ],
      expected: [45 * MINUTE, 5 * MINUTE + 500],
    });
  });
});

describe('recordingBuildDelayed', () => {
  test('counts from the capture end, by the capture length', () => {
    assert({
      given: 'an 80 minute capture at its bound, and just past it',
      should: 'be late only past it',
      actual: [
        recordingBuildDelayed(capture, endedAtMs + 45 * MINUTE),
        recordingBuildDelayed(capture, endedAtMs + 45 * MINUTE + 1),
      ],
      expected: [false, true],
    });
  });
});

describe('recordingPreparationOf', () => {
  const queued = { status: 'queued', attemptCount: 1, progress } as const;
  test('says what is really happening, from the job', () => {
    assert({
      given:
        'capture running, no worker yet, a worker with figures, and a late one',
      should: 'answer each from its own facts',
      actual: [
        recordingPreparationOf({ status: 'requested' }, null, endedAtMs),
        recordingPreparationOf(
          processing,
          { status: 'queued', attemptCount: 1 },
          endedAtMs,
        ),
        recordingPreparationOf(processing, queued, endedAtMs),
        recordingPreparationOf(processing, queued, endedAtMs + 46 * MINUTE),
      ],
      expected: [
        { stage: 'capturing' },
        { stage: 'waiting', delayed: false },
        { stage: 'building', delayed: false, progress },
        { stage: 'building', delayed: true, progress },
      ],
    });
  });

  test('has nothing to say once preparation is over', () => {
    assert({
      given: 'a failed Recording',
      should: 'not read as being prepared',
      actual: recordingPreparationOf(
        { status: 'failed', reason: 'no_media', failedAt: capture.endedAt },
        null,
        endedAtMs,
      ),
      expected: null,
    });
  });
});
