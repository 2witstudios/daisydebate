import { isAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { leaseLapseReport } from './lease-lapse-report';
setupRitewayBun();

const recorded = () => {
  const lines: unknown[][] = [];
  const captured: unknown[][] = [];
  const report = leaseLapseReport({
    logger: { log: (...line) => lines.push(line) },
    reporter: { capture: (...call) => captured.push(call) },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
  });
  return { lines, captured, report };
};

test('a lapse caused by a failing renewal is logged with its length and linked to the failure', () => {
  const refused = new Error('renewal refused');
  const { lines, captured, report } = recorded();
  report({
    lapsedMs: 10_000.4,
    unproven: { kind: 'renewal_failed', error: refused },
  });
  const [error, context] = captured[0] ?? [];
  assert({
    given: 'a lapse of ten seconds whose latest renewal failed',
    should:
      'log why and how long, and report one infrastructure error caused by the renewal failure under the lease route',
    actual: {
      lines,
      code: isAppError(error) ? error.code : null,
      cause: error instanceof Error ? error.cause : null,
      context,
    },
    expected: {
      lines: [
        [
          'availability.lease_lapsing',
          {
            operation: 'availability.lease',
            cause: 'renewal_failed',
            durationMs: 10_000,
          },
          'Web service lease unproven',
        ],
      ],
      code: 'INFRASTRUCTURE',
      cause: refused,
      context: {
        requestId: 'r4n6p8r2t4v6x8z1k3b5c7d9',
        route: 'web.service-lease.lapsed',
        errorCode: 'INFRASTRUCTURE',
      },
    },
  });
});

test('a lapse from a hung renewal, or a failure that is no Error, links no cause', () => {
  const { lines, captured, report } = recorded();
  report({ lapsedMs: 15_000, unproven: { kind: 'renewal_pending' } });
  report({
    lapsedMs: 20_000,
    unproven: { kind: 'renewal_failed', error: 'not an error' },
  });
  assert({
    given: 'a hung-renewal lapse, and a failure that is not an Error',
    should: 'log each reason and link no cause',
    actual: {
      causes: lines.map(([, fields]) => (fields as { cause: string }).cause),
      linked: captured.map(([error]) =>
        error instanceof Error ? error.cause : null,
      ),
    },
    expected: {
      causes: ['renewal_pending', 'renewal_failed'],
      linked: [undefined, undefined],
    },
  });
});

test('a log that throws never costs the report', () => {
  const captured: unknown[] = [];
  const report = leaseLapseReport({
    logger: {
      log: () => {
        throw new Error('log transport down');
      },
    },
    reporter: { capture: (error) => captured.push(error) },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
  });
  report({ lapsedMs: 10_000, unproven: { kind: 'renewal_pending' } });
  assert({
    given: 'a lapse whose log line throws',
    should: 'still report it',
    actual: captured.length,
    expected: 1,
  });
});
