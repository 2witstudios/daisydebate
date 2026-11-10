import { createAppError, createRefusal } from '@daisy/errors';
import { publicationStopError, publicationStopOf } from '@daisy/media/audio';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { recoverableFailure } from './recoverable-failure';
setupRitewayBun();

const record = (
  isCapacity: (error: unknown) => boolean = () => false,
  now: () => number = () => 0,
) => {
  const lines: unknown[][] = [];
  const captured: unknown[][] = [];
  const failed = recoverableFailure({
    isCapacity,
    now,
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
    now: () => 0,
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
    now: () => 0,
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
    now: () => 0,
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
    now: () => 0,
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

test('a lapsed service lease is logged each time and reported only once it persists (DAISY-WEB-9)', () => {
  const lapse = createRefusal(
    'AUTHORIZATION',
    'service-lease-lapsed',
    'Maintenance service is not current',
  );
  const denied = createAppError('AUTHORIZATION', 'Permission denied');
  const { lines, captured, failed } = record();
  for (let i = 0; i < 3; i++) {
    failed(lapse, 'tick');
    failed(lapse, 'discover');
  }
  const transient = { lines: lines.length, captured: captured.length };
  for (let i = 0; i < 6; i++) failed(lapse, 'tick');
  failed(denied, 'tick');
  const lapsed = {
    operation: 'round.maintenance.tick.lease',
    errorCode: 'AUTHORIZATION',
    cause: 'service-lease-lapsed',
  };
  assert({
    given:
      'a one-second lapse failing two stages three times, then six more lapses of one stage and a real authorization failure',
    should:
      'log every lapse, report none while transient, report the stage once past the bound, and report the real failure at once',
    actual: {
      transient,
      last: lines.slice(-3).map(([, fields]) => fields),
      captured: captured.map(([error, context]) => [
        error === lapse ? 'lapse' : 'denied',
        (context as { route: string }).route,
      ]),
    },
    expected: {
      transient: { lines: 6, captured: 0 },
      last: [
        lapsed,
        lapsed,
        { operation: 'round.maintenance.tick', errorCode: 'AUTHORIZATION' },
      ],
      captured: [
        ['lapse', 'round.maintenance.tick.lease'],
        ['denied', 'round.maintenance.tick'],
      ],
    },
  });
});

test('isolated lease lapses apart by more than the quiet gap never add up to a report', () => {
  const lapse = createRefusal('AUTHORIZATION', 'service-lease-lapsed');
  let nowMs = 0;
  const { lines, captured, failed } = record(
    () => false,
    () => nowMs,
  );
  for (let i = 0; i < 20; i++) {
    failed(lapse, 'tick');
    nowMs += 30_001;
  }
  const isolated = { lines: lines.length, captured: captured.length };
  for (let i = 0; i < 9; i++) {
    failed(lapse, 'tick');
    nowMs += 500;
  }
  assert({
    given:
      'twenty one-off lapses of a stage each more than 30 s apart, then nine lapses 500 ms apart',
    should:
      'log all of them, report none of the isolated ones, and report the run that persists once',
    actual: { isolated, captured: captured.length },
    expected: { isolated: { lines: 20, captured: 0 }, captured: 1 },
  });
});

test('a clock that throws costs only the lapse report, never its log line', () => {
  const lapse = createRefusal('AUTHORIZATION', 'service-lease-lapsed');
  const { lines, captured, failed } = record(
    () => false,
    () => {
      throw new Error('clock broke');
    },
  );
  let thrown: unknown = null;
  try {
    for (let i = 0; i < 9; i++) failed(lapse, 'tick');
  } catch (error) {
    thrown = error;
  }
  assert({
    given: 'nine lease lapses with a clock that throws',
    should: 'log each lapse, report none, and never throw to the worker',
    actual: { thrown, lines: lines.length, captured: captured.length },
    expected: { thrown: null, lines: 9, captured: 0 },
  });
});
