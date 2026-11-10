import {
  createAppError,
  createInvariantError,
  toPublicError,
  type ErrorCode,
} from '@daisy/errors';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isReportedFailure, reportRequestError } from './request-failure';
setupRitewayBun();

describe('isReportedFailure', () => {
  test('only a failure someone must look at is reported', () => {
    const reported = (error: unknown) =>
      isReportedFailure(toPublicError(error, 'r4n6p8r2t4v6x8z1k3b5c7d9'));
    const codes: readonly ErrorCode[] = [
      'VALIDATION',
      'AUTHENTICATION',
      'AUTHORIZATION',
      'NOT_FOUND',
      'CONFLICT',
      'PAYLOAD_TOO_LARGE',
      'RATE_LIMIT',
      'INFRASTRUCTURE',
      'INTERNAL',
    ];
    assert({
      given: 'each public code, an invariant violation and a raw error',
      should:
        'report the 5xx codes, the invariant and the raw error, never a client-class refusal',
      actual: {
        codes: codes.map((code) => [code, reported(createAppError(code))]),
        invariant: reported(createInvariantError('round.phase')),
        raw: reported(new Error('connection reset secret=xyz')),
      },
      expected: {
        codes: [
          ['VALIDATION', false],
          ['AUTHENTICATION', false],
          ['AUTHORIZATION', false],
          ['NOT_FOUND', false],
          ['CONFLICT', false],
          ['PAYLOAD_TOO_LARGE', false],
          ['RATE_LIMIT', false],
          ['INFRASTRUCTURE', true],
          ['INTERNAL', true],
        ],
        invariant: true,
        raw: true,
      },
    });
  });
});

describe('reportRequestError', () => {
  const record = (capture?: () => never) => {
    const lines: unknown[][] = [];
    const captured: unknown[][] = [];
    const report = (error: unknown, requestId?: string) =>
      reportRequestError({
        error,
        requestId,
        route: '/rooms/[id]',
        logger: { log: (...line) => lines.push(line) },
        reporter: {
          capture: capture ?? ((...call) => void captured.push(call)),
        },
      });
    return { lines, captured, report };
  };

  test('a page-render AppError keeps its own code', () => {
    const { lines, captured, report } = record();
    const outage = createAppError('INFRASTRUCTURE', 'pool exhausted');
    report(outage, 'wroo9yv5m1xchtokg7a1al8j');
    assert({
      given: 'an INFRASTRUCTURE AppError thrown while rendering a page',
      should:
        'log and report INFRASTRUCTURE, not INTERNAL, with the raw error only in the report',
      actual: { lines, captured },
      expected: {
        lines: [
          [
            'request.unhandled',
            {
              operation: 'request.unhandled',
              requestId: 'wroo9yv5m1xchtokg7a1al8j',
              route: '/rooms/[id]',
              errorCode: 'INFRASTRUCTURE',
            },
            'Unhandled request failure',
          ],
        ],
        captured: [
          [
            outage,
            {
              requestId: 'wroo9yv5m1xchtokg7a1al8j',
              route: '/rooms/[id]',
              errorCode: 'INFRASTRUCTURE',
            },
          ],
        ],
      },
    });
  });

  test('a client-class refusal is logged but never reported', () => {
    const { lines, captured, report } = record();
    report(createAppError('AUTHORIZATION'), undefined);
    report(createAppError('NOT_FOUND'), undefined);
    assert({
      given:
        'AUTHORIZATION and NOT_FOUND thrown during a render without a request id',
      should:
        'log each with its own code and send nothing to the error tracker',
      actual: {
        codes: lines.map(
          (line) => (line[1] as { errorCode: string }).errorCode,
        ),
        requestIds: lines.map((line) => 'requestId' in (line[1] as object)),
        captured,
      },
      expected: {
        codes: ['AUTHORIZATION', 'NOT_FOUND'],
        requestIds: [false, false],
        captured: [],
      },
    });
  });

  test('an untyped failure is INTERNAL and reported', () => {
    const { lines, captured, report } = record();
    const raw = new Error('connection reset secret=xyz');
    report(raw, undefined);
    assert({
      given: 'a raw error with a secret-looking message and no request id',
      should:
        'log INTERNAL with nothing from the message and report it under the unknown request id',
      actual: { lines, captured },
      expected: {
        lines: [
          [
            'request.unhandled',
            {
              operation: 'request.unhandled',
              route: '/rooms/[id]',
              errorCode: 'INTERNAL',
            },
            'Unhandled request failure',
          ],
        ],
        captured: [
          [
            raw,
            {
              requestId: 'unknown',
              route: '/rooms/[id]',
              errorCode: 'INTERNAL',
            },
          ],
        ],
      },
    });
  });

  test('a failing reporter never fails the request hook', () => {
    const { lines, report } = record(() => {
      throw new Error('vendor down');
    });
    let threw = false;
    try {
      report(new Error('render failed'), 'wroo9yv5m1xchtokg7a1al8j');
    } catch {
      threw = true;
    }
    assert({
      given: 'a reporter that throws',
      should: 'still log the failure and not throw',
      actual: { logged: lines.length, threw },
      expected: { logged: 1, threw: false },
    });
  });
});
