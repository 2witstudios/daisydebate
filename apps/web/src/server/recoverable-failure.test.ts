import { createAppError } from '@daisy/errors';
import { publicationStopError, publicationStopOf } from '@daisy/media/audio';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { recoverableFailure } from './recoverable-failure';
setupRitewayBun();

const record = (isCapacity: (error: unknown) => boolean = () => false) => {
  const lines: unknown[][] = [];
  const captured: unknown[][] = [];
  const failed = recoverableFailure({
    isCapacity,
    logger: { log: (...line) => lines.push(line) },
    reporter: { capture: (...call) => captured.push(call) },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
    event: 'round.maintenance.failed',
    operation: 'round.maintenance',
    message: 'Competitive maintenance remains recoverable',
  });
  return { lines, captured, failed };
};

test('a recoverable worker failure keeps its code and stage', () => {
  const { lines, captured, failed } = record();
  const capacity = createAppError('CONFLICT', 'lease rotated token=abc');
  failed(capacity, 'finalize');
  assert({
    given: 'an AppError raised in the finalize stage',
    should:
      'log only the operation stage and its own code, and hand the raw error to the reporter',
    actual: { lines, captured },
    expected: {
      lines: [
        [
          'round.maintenance.failed',
          { operation: 'round.maintenance.finalize', errorCode: 'CONFLICT' },
          'Competitive maintenance remains recoverable',
        ],
      ],
      captured: [
        [
          capacity,
          {
            requestId: 'r4n6p8r2t4v6x8z1k3b5c7d9',
            route: 'round.maintenance.finalize',
            errorCode: 'CONFLICT',
          },
        ],
      ],
    },
  });
});

test('an untyped failure never claims a code it does not carry', () => {
  const { lines, failed } = record();
  failed(new Error('connection reset secret=xyz'), 'discover');
  assert({
    given: 'a raw error with a secret-looking message',
    should: 'log INTERNAL for the stage and nothing from the message',
    actual: lines,
    expected: [
      [
        'round.maintenance.failed',
        { operation: 'round.maintenance.discover', errorCode: 'INTERNAL' },
        'Competitive maintenance remains recoverable',
      ],
    ],
  });
});

test('capacity backpressure stays silent within its bound', () => {
  const capacity = createAppError(
    'INFRASTRUCTURE',
    'Transcript transaction capacity unavailable',
  );
  const { lines, captured, failed } = record((error) => error === capacity);
  for (let i = 0; i < 8; i++) failed(capacity, 'tick');
  const withinBound = lines.length;
  failed(capacity, 'tick');
  failed(capacity, 'tick');
  failed(capacity, 'other');
  assert({
    given:
      'eight admission refusals of one stage, two more, and one of another stage',
    should:
      'log nothing within the bound, one starvation line past it, and count each stage on its own',
    actual: { withinBound, lines, captured: captured.length },
    expected: {
      withinBound: 0,
      lines: [
        [
          'round.maintenance.failed',
          {
            operation: 'round.maintenance.tick.capacity',
            errorCode: 'INFRASTRUCTURE',
          },
          'Competitive maintenance remains recoverable',
        ],
      ],
      captured: 1,
    },
  });
});

test('a slow stage that keeps being refused is still reported', () => {
  const capacity = createAppError(
    'INFRASTRUCTURE',
    'Transcript transaction capacity unavailable',
  );
  const { lines, failed } = record((error) => error === capacity);
  for (let i = 0; i < 18; i++) failed(capacity, 'renew');
  assert({
    given:
      'eighteen admission refusals of a stage on a slow cadence (no clock is consulted)',
    should: 'report the starvation once per nine refusals',
    actual: lines.map(([, fields]) => fields),
    expected: [
      {
        operation: 'round.maintenance.renew.capacity',
        errorCode: 'INFRASTRUCTURE',
      },
      {
        operation: 'round.maintenance.renew.capacity',
        errorCode: 'INFRASTRUCTURE',
      },
    ],
  });
});

test('a bot publish failure names its stop, and nothing else of the error', () => {
  const lines: unknown[][] = [];
  const failed = recoverableFailure({
    isCapacity: () => false,
    logger: { log: (...line) => lines.push(line) },
    reporter: { capture: () => undefined },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
    event: 'round.speaking.failed',
    operation: 'round.speaking',
    message: 'Bot speech stays uncredited',
    cause: publicationStopOf,
  });
  failed(publicationStopError('stall', 'stopped token=abc'), 'publish');
  failed(
    publicationStopError('handoff', 'Native audio handoff failed'),
    'publish',
  );
  failed(
    createAppError('INFRASTRUCTURE', 'other', { stop: 'token=abc' }),
    'publish',
  );
  assert({
    given:
      'a stalled publish, a failed native handoff and an error with a forged stop (ISSUE-514-r1)',
    should:
      'log the stall and handoff as the cause, and no cause for a code outside the fixed set',
    actual: lines.map((line) => line[1]),
    expected: [
      {
        operation: 'round.speaking.publish',
        errorCode: 'INFRASTRUCTURE',
        cause: 'stall',
      },
      {
        operation: 'round.speaking.publish',
        errorCode: 'INFRASTRUCTURE',
        cause: 'handoff',
      },
      { operation: 'round.speaking.publish', errorCode: 'INFRASTRUCTURE' },
    ],
  });
});
