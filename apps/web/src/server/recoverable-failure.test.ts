import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { recoverableFailure } from './recoverable-failure';
setupRitewayBun();

const record = () => {
  const lines: unknown[][] = [];
  const captured: unknown[][] = [];
  const failed = recoverableFailure({
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
