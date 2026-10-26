import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, type ErrorCode } from '@daisy/errors';
import {
  CAPTURE_FAILURE_STAGES,
  CAPTURE_UNCAUGHT_EXIT,
  atStage,
  captureFailureExit,
  describeCaptureExit,
  tagCaptureFailure,
} from './capture-exit';
import { CAPTURE_FINISHED_EXIT } from './supervisor';
setupRitewayBun();

const codes: ErrorCode[] = [
  'VALIDATION',
  'AUTHENTICATION',
  'AUTHORIZATION',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'INVARIANT',
  'RATE_LIMIT',
  'INFRASTRUCTURE',
  'INTERNAL',
];
const pairs = CAPTURE_FAILURE_STAGES.flatMap((stage) =>
  codes.map((code) => ({ stage, code })),
);
const exitOf = ({ stage, code }: (typeof pairs)[number]) =>
  captureFailureExit(tagCaptureFailure(stage, createAppError(code)));

test('every failure stage and error code has its own exit status', () => {
  const statuses = pairs.map(exitOf);
  assert({
    given: 'each enumerated stage with each error code',
    should: 'decode back to that same stage and code',
    actual: statuses.map(describeCaptureExit),
    expected: pairs.map(({ stage, code }) => ({
      cause: stage,
      errorCode: code,
    })),
  });
  assert({
    given: 'all the staged statuses',
    should:
      'be distinct, and clear of success, a bare 1, the finished, uncaught and signal statuses',
    actual: {
      distinct: new Set(statuses).size === statuses.length,
      clear: statuses.every(
        (s) => s > 4 && s < 128 && ![0, 1, CAPTURE_FINISHED_EXIT].includes(s),
      ),
    },
    expected: { distinct: true, clear: true },
  });
});

test('a failure is attributed to the stage it was raised in', async () => {
  const renewal = tagCaptureFailure('renewal', createAppError('CONFLICT'));
  const wrapped = createAppError('INFRASTRUCTURE', 'ended', renewal);
  assert({
    given: 'a session failure wrapping a tagged renewal refusal',
    should: "report the renewal stage and the refusal's own code",
    actual: describeCaptureExit(captureFailureExit(wrapped)),
    expected: { cause: 'renewal', errorCode: 'CONFLICT' },
  });
  const inner = tagCaptureFailure('token', createAppError('AUTHORIZATION'));
  assert({
    given: 'an error tagged by an inner stage and then an outer one',
    should: 'keep the inner stage',
    actual: describeCaptureExit(
      captureFailureExit(tagCaptureFailure('batch', inner)),
    ),
    expected: { cause: 'token', errorCode: 'AUTHORIZATION' },
  });
  const rejected = await atStage(
    'lease',
    Promise.reject(createAppError('RATE_LIMIT')),
  ).catch((error: unknown) => error);
  assert({
    given: 'a stage whose work rejects',
    should: 'tag the rejection with that stage',
    actual: describeCaptureExit(captureFailureExit(rejected)),
    expected: { cause: 'lease', errorCode: 'RATE_LIMIT' },
  });
  assert({
    given: 'an untagged failure that is not an application error',
    should: 'report the session stage with the internal code',
    actual: describeCaptureExit(captureFailureExit(new Error('raw detail'))),
    expected: { cause: 'session', errorCode: 'INTERNAL' },
  });
});

test('statuses no stage produced are described without detail', () => {
  assert({
    given: 'the uncaught status, a signal, a bare 1 and an out-of-range status',
    should: 'describe each by kind only',
    actual: [CAPTURE_UNCAUGHT_EXIT, 139, 1, 200].map(describeCaptureExit),
    expected: [
      { cause: 'uncaught' },
      { cause: 'signal' },
      { cause: 'unknown' },
      { cause: 'unknown' },
    ],
  });
});
