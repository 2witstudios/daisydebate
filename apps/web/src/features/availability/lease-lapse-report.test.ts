import { createAppError, isAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { leaseLapseReport } from './lease-lapse-report';
setupRitewayBun();

const recorded = () => {
  const lines: unknown[][] = [];
  const captured: unknown[][] = [];
  const channels = leaseLapseReport({
    logger: { log: (...line) => lines.push(line) },
    reporter: { capture: (...call) => captured.push(call) },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
  });
  return { lines, captured, channels };
};

test('a lapse caused by a failing renewal is logged with its length and reported linked to the failure', () => {
  const refused = new Error('renewal refused');
  const { lines, captured, channels } = recorded();
  const lapse = {
    lapsedMs: 10_000.4,
    unproven: { kind: 'renewal_failed', error: refused },
  } as const;
  channels.log(lapse);
  channels.report(lapse);
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
            errorCode: 'INFRASTRUCTURE',
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

test('a lapse from a hung or late renewal, or a failure that is no Error, links no cause', () => {
  const { lines, captured, channels } = recorded();
  for (const lapse of [
    { lapsedMs: 15_000, unproven: { kind: 'renewal_pending' } },
    { lapsedMs: 16_000, unproven: { kind: 'renewal_late' } },
    {
      lapsedMs: 20_000,
      unproven: { kind: 'renewal_failed', error: 'not an error' },
    },
  ] as const) {
    channels.log(lapse);
    channels.report(lapse);
  }
  assert({
    given:
      'a hung-renewal lapse, a late-renewal lapse, and a failure that is not an Error',
    should: 'log each reason and link no cause',
    actual: {
      causes: lines.map(([, fields]) => (fields as { cause: string }).cause),
      linked: captured.map(([error]) =>
        error instanceof Error ? error.cause : null,
      ),
    },
    expected: {
      causes: ['renewal_pending', 'renewal_late', 'renewal_failed'],
      linked: [undefined, undefined, undefined],
    },
  });
});

test('a lapse caused by a typed refusal keeps the refusal’s own code', () => {
  const conflict = createAppError(
    'CONFLICT',
    'Service lease belongs to another role',
  );
  const { lines, captured, channels } = recorded();
  const lapse = {
    lapsedMs: 10_000,
    unproven: { kind: 'renewal_failed', error: conflict },
  } as const;
  channels.log(lapse);
  channels.report(lapse);
  const [error, context] = captured[0] ?? [];
  assert({
    given:
      'a lapse whose renewals are refused because another role holds the row',
    should: 'log and report it as CONFLICT, linked to the refusal',
    actual: {
      logged: (lines[0]?.[1] as { errorCode: string }).errorCode,
      code: isAppError(error) ? error.code : null,
      tag: (context as { errorCode: string }).errorCode,
      cause: error instanceof Error ? error.cause : null,
    },
    expected: {
      logged: 'CONFLICT',
      code: 'CONFLICT',
      tag: 'CONFLICT',
      cause: conflict,
    },
  });
});

test('a channel that cannot deliver throws, so the loop tries it again', () => {
  const failing = () => {
    throw new Error('down');
  };
  const channels = leaseLapseReport({
    logger: { log: failing },
    reporter: { capture: failing },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
  });
  const lapse = {
    lapsedMs: 10_000,
    unproven: { kind: 'renewal_pending' },
  } as const;
  const threw = (send: () => void) => {
    try {
      send();
      return false;
    } catch {
      return true;
    }
  };
  assert({
    given: 'a log and a tracker that both throw',
    should: 'throw from each channel',
    actual: [
      threw(() => channels.log(lapse)),
      threw(() => channels.report(lapse)),
    ],
    expected: [true, true],
  });
});
