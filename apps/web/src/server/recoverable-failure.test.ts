import { createAppError, createRefusal } from '@daisy/errors';
import { publicationStopError, publicationStopOf } from '@daisy/media/audio';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isServiceLeaseLapse } from '@daisy/db/service-lease-lapse';
import { recoverableFailure } from './recoverable-failure';
setupRitewayBun();

const record = (
  isCapacity: (error: unknown) => boolean = () => false,
  isLeaseLapse: (error: unknown) => boolean = isServiceLeaseLapse,
) => {
  const lines: unknown[][] = [];
  const captured: unknown[][] = [];
  const failed = recoverableFailure({
    isCapacity,
    isLeaseLapse,
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
    isLeaseLapse: () => false,
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
    isLeaseLapse: () => false,
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
    isLeaseLapse: () => {
      throw new Error('lapse check broke');
    },
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
    given:
      'a log, cause reader, capacity check, lapse check or reporter that throws',
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
    isLeaseLapse: () => false,
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

test('the failure sink says whether it reported or deferred a failure', () => {
  const capacity = createAppError('INFRASTRUCTURE', 'capacity');
  const { failed } = record((error) => error === capacity);
  const verdicts = [
    failed(new Error('genuine'), 'tick'),
    ...Array.from({ length: 9 }, () => failed(capacity, 'tick')),
  ];
  assert({
    given:
      'a genuine failure, then nine capacity refusals for one stage (the bound is eight)',
    should:
      'answer reported for the genuine failure, deferred for the eight absorbed refusals, and reported for the ninth',
    actual: verdicts,
    expected: [
      'reported',
      ...Array.from({ length: 8 }, () => 'deferred'),
      'reported',
    ],
  });
});

test('a failure neither sink took is unrecorded, not reported', () => {
  const failed = recoverableFailure({
    isCapacity: () => false,
    isLeaseLapse: () => false,
    logger: {
      log: () => {
        throw new Error('log sink');
      },
    },
    reporter: {
      capture: () => {
        throw new Error('reporter');
      },
    },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
    event: 'round.maintenance.failed',
    operation: 'round.maintenance',
    message: 'Competitive maintenance remains recoverable',
  });
  assert({
    given: 'a failure when both the logger and the reporter throw',
    should: 'answer unrecorded, so a caller retries rather than settling it',
    actual: failed(new Error('genuine'), 'tick'),
    expected: 'unrecorded',
  });
});

test('a failure only the log line took is logged, not reported, so a caller can retry the tracker', () => {
  const lines: unknown[] = [];
  const failed = recoverableFailure({
    isCapacity: () => false,
    isLeaseLapse: () => false,
    logger: { log: (...line) => void lines.push(line) },
    reporter: {
      capture: () => {
        throw new Error('tracker down');
      },
    },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
    event: 'round.maintenance.failed',
    operation: 'round.maintenance',
    message: 'Competitive maintenance remains recoverable',
  });
  assert({
    given: 'a working log sink and a reporter that throws',
    should: 'log the line and answer logged, never reported',
    actual: [failed(new Error('genuine'), 'tick'), lines.length],
    expected: ['logged', 1],
  });
});

test('a failure the reporter took is reported even when its log line threw', () => {
  const failed = recoverableFailure({
    isCapacity: () => false,
    isLeaseLapse: () => false,
    logger: {
      log: () => {
        throw new Error('log sink');
      },
    },
    reporter: { capture: () => undefined },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
    event: 'round.maintenance.failed',
    operation: 'round.maintenance',
    message: 'Competitive maintenance remains recoverable',
  });
  assert({
    given: 'a reporter that takes the failure and a log sink that throws',
    should:
      'answer reported, so a caller settles rather than re-sending it every tick',
    actual: failed(new Error('genuine'), 'tick'),
    expected: 'reported',
  });
});

const lapse = createRefusal(
  'AUTHORIZATION',
  'service-lease-lapsed',
  'Maintenance service is not current',
);

test('a lapsed service lease is a warning, never a stage failure or a report (DAISY-WEB-9)', () => {
  const { lines, captured, failed } = record();
  for (let i = 0; i < 20; i++) failed(lapse, i % 2 ? 'tick' : 'finalize');
  const denied = createAppError('AUTHORIZATION', 'Permission denied');
  failed(denied, 'tick');
  assert({
    given:
      'twenty lapse refusals across two stages, then a real authorization failure',
    should:
      'log each lapse under the warning event with its cause, and report only the real failure',
    actual: {
      first: lines[0],
      events: [...new Set(lines.map(([event]) => event))],
      captured: captured.map(([error]) => error),
    },
    expected: {
      first: [
        'service.lease_lapsed',
        {
          operation: 'round.maintenance.finalize.lease',
          errorCode: 'AUTHORIZATION',
          cause: 'service-lease-lapsed',
        },
        'Service lease not current; the next renewal restores it',
      ],
      events: ['service.lease_lapsed', 'round.maintenance.failed'],
      captured: [denied],
    },
  });
});
