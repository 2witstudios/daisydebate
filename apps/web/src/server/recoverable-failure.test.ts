import { createAppError, createRefusal } from '@daisy/errors';
import { publicationStopError, publicationStopOf } from '@daisy/media/audio';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { leaseLapses, type LeaseLapses } from './lease-lapse';
import { recoverableFailure } from './recoverable-failure';
setupRitewayBun();

const transientLapses: LeaseLapses = { observe: () => 'transient' };

const record = (
  isCapacity: (error: unknown) => boolean = () => false,
  lapses: LeaseLapses = transientLapses,
) => {
  const lines: unknown[][] = [];
  const captured: unknown[][] = [];
  const failed = recoverableFailure({
    isCapacity,
    leaseLapses: lapses,
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
    leaseLapses: transientLapses,
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

test('a sink that throws never fails its caller, and its other steps still run (ISSUE-789)', () => {
  const captured: unknown[] = [];
  const failed = recoverableFailure({
    isCapacity: () => false,
    leaseLapses: transientLapses,
    logger: {
      log: () => {
        throw new Error('log transport down');
      },
    },
    reporter: { capture: (error) => captured.push(error) },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
    event: 'round.control.failed',
    operation: 'round.control',
    message: 'Control receipt work remains recoverable',
    cause: () => {
      throw new Error('cause reader broke');
    },
  });
  const fault = new Error('stop failed');
  let thrown: unknown = null;
  try {
    failed(fault, 'stop');
  } catch (error) {
    thrown = error;
  }
  const dead = recoverableFailure({
    isCapacity: () => {
      throw new Error('capacity check broke');
    },
    leaseLapses: transientLapses,
    logger: { log: () => {} },
    reporter: {
      capture: () => {
        throw new Error('reporter down');
      },
    },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
    event: 'round.control.failed',
    operation: 'round.control',
    message: 'Control receipt work remains recoverable',
  });
  try {
    dead(fault, 'pulse');
  } catch (error) {
    thrown = error;
  }
  assert({
    given: 'a log, cause reader, capacity check or reporter that throws',
    should:
      'never throw to the worker, and still hand the error to the reporter',
    actual: { thrown, captured },
    expected: { thrown: null, captured: [fault] },
  });
});

test('a cause reader that throws costs only the cause, never the log line (ISSUE-789)', () => {
  const lines: unknown[][] = [];
  const failed = recoverableFailure({
    isCapacity: () => false,
    leaseLapses: transientLapses,
    logger: { log: (...line) => lines.push(line) },
    reporter: { capture: () => {} },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
    event: 'round.speaking.failed',
    operation: 'round.speaking',
    message: 'Bot speech stays uncredited',
    cause: () => {
      throw new Error('cause reader broke');
    },
  });
  failed(createAppError('INFRASTRUCTURE', 'stall'), 'publish');
  assert({
    given: 'a working log and a cause reader that throws',
    should: 'still log the failure, without a cause',
    actual: lines,
    expected: [
      [
        'round.speaking.failed',
        { operation: 'round.speaking.publish', errorCode: 'INFRASTRUCTURE' },
        'Bot speech stays uncredited',
      ],
    ],
  });
});

const lapse = createRefusal(
  'AUTHORIZATION',
  'service-lease-lapsed',
  'Maintenance service is not current',
);

test('a lapsed service lease is logged every time and reported only when the instance says it persisted (DAISY-WEB-9)', () => {
  const verdicts = [
    'transient',
    'transient',
    'persisted',
    'transient',
  ] as const;
  let observed = 0;
  const { lines, captured, failed } = record(() => false, {
    observe: () => verdicts[observed++]!,
  });
  for (const stage of ['tick', 'evaluate', 'tick', 'discover'])
    failed(lapse, stage);
  failed(createAppError('AUTHORIZATION', 'Permission denied'), 'tick');
  assert({
    given:
      'four lapses whose instance state persists on the third, then a real authorization failure',
    should:
      'log each lapse with its cause, report only the persisted one, and report the real failure at once',
    actual: {
      lines: lines.map(([, fields]) => fields),
      captured: captured.map(([error, context]) => [
        error === lapse ? 'lapse' : 'denied',
        (context as { route: string }).route,
      ]),
    },
    expected: {
      lines: [
        ...['tick', 'evaluate', 'tick', 'discover'].map((stage) => ({
          operation: `round.maintenance.${stage}.lease`,
          errorCode: 'AUTHORIZATION',
          cause: 'service-lease-lapsed',
        })),
        { operation: 'round.maintenance.tick', errorCode: 'AUTHORIZATION' },
      ],
      captured: [
        ['lapse', 'round.maintenance.tick.lease'],
        ['denied', 'round.maintenance.tick'],
      ],
    },
  });
});

test('one burst of lapses across many Rounds and sinks never reports (DAISY-WEB-9)', () => {
  let nowMs = 0;
  const shared = leaseLapses(() => nowMs);
  const maintenance = record(() => false, shared);
  const billing = record(() => false, shared);
  for (let i = 0; i < 300; i++) {
    maintenance.failed(lapse, i % 2 ? 'tick' : 'finalize');
    nowMs += 3;
  }
  billing.failed(lapse, 'sync');
  assert({
    given:
      'three hundred Round failures in one second of lapse and a billing lapse, on one shared instance state',
    should: 'log each and report none',
    actual: [
      maintenance.lines.length + billing.lines.length,
      maintenance.captured.length + billing.captured.length,
    ],
    expected: [301, 0],
  });
});

test('a lapse state that throws costs only the report, never the log line', () => {
  const { lines, captured, failed } = record(() => false, {
    observe: () => {
      throw new Error('clock broke');
    },
  });
  let thrown: unknown = null;
  try {
    failed(lapse, 'tick');
  } catch (error) {
    thrown = error;
  }
  assert({
    given: 'a lease lapse whose instance state throws',
    should: 'log the lapse, report nothing, and never throw to the worker',
    actual: { thrown, lines: lines.length, captured: captured.length },
    expected: { thrown: null, lines: 1, captured: 0 },
  });
});
