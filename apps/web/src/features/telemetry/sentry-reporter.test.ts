import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { reporterFrom } from './sentry-reporter';

setupRitewayBun();

describe('reporterFrom (ADR 0037 port mapping)', () => {
  test('maps the port context onto vendor tags, extra and user', () => {
    let captured: unknown[] = [];
    const reporter = reporterFrom((error, context) => {
      captured = [error, context];
    });
    reporter.capture(new Error('boom'), {
      requestId: 'r1',
      route: 'attendance.check-in',
      errorCode: 'INTERNAL',
      userId: 'm4t97chwn29kyca9aqt8yqk2',
    });
    const [error, context] = captured as [
      Error,
      {
        tags: { route: string; errorCode: string };
        extra: { requestId: string };
        user?: { id: string };
      },
    ];
    assert({
      given: 'a capture with full context',
      should: 'forward the raw error untouched',
      actual: (error as Error).message,
      expected: 'boom',
    });
    assert({
      given: 'route and errorCode',
      should: 'carry them as bounded-vocabulary tags',
      actual: context.tags,
      expected: { route: 'attendance.check-in', errorCode: 'INTERNAL' },
    });
    assert({
      given: 'the per-request id',
      should: 'carry it as extra, never an indexed tag',
      actual: context.extra,
      expected: { requestId: 'r1' },
    });
    assert({
      given: 'a userId',
      should: 'carry the cuid2 id as the whole user',
      actual: context.user,
      expected: { id: 'm4t97chwn29kyca9aqt8yqk2' },
    });
  });

  test('sends no user when the context has none', () => {
    let context: Record<string, unknown> = {};
    const reporter = reporterFrom((_error, sent) => {
      context = sent;
    });
    reporter.capture(new Error('x'), {
      requestId: 'r2',
      route: 'op',
      errorCode: 'VALIDATION',
    });
    assert({
      given: 'a capture without a userId',
      should: 'carry no user at all',
      actual: 'user' in context,
      expected: false,
    });
  });
});
