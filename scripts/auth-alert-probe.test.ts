import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { composeAlertMessage, evaluateOriginProbe } from './auth-alert-probe';

setupRitewayBun();

const HEALTHY_HEADERS = new Map<string, string>([
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'DENY'],
  ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
]);

describe('evaluateOriginProbe (AUTH-7.7)', () => {
  test('a 200 with every required security header proves ok', () => {
    assert({
      given: 'a ready 200 carrying the exact security-header contract',
      should: 'report ok with no issues',
      actual: evaluateOriginProbe({ status: 200, headers: HEALTHY_HEADERS }),
      expected: { ok: true, issues: [] },
    });
  });

  test('a non-200 status is a routing issue (negative control on the healthy case)', () => {
    const result = evaluateOriginProbe({
      status: 503,
      headers: HEALTHY_HEADERS,
    });
    assert({
      given: 'a 503 from the readiness endpoint',
      should: 'report not-ok naming the status',
      actual: {
        ok: result.ok,
        namesStatus: result.issues.some((i) => i.includes('503')),
      },
      expected: { ok: false, namesStatus: true },
    });
  });

  test('a missing security header is reported by name', () => {
    const headers = new Map(HEALTHY_HEADERS);
    headers.delete('strict-transport-security');
    const result = evaluateOriginProbe({ status: 200, headers });
    assert({
      given: 'a response missing Strict-Transport-Security',
      should: 'report not-ok naming that header',
      actual: {
        ok: result.ok,
        namesHeader: result.issues.some((i) =>
          i.includes('strict-transport-security'),
        ),
      },
      expected: { ok: false, namesHeader: true },
    });
  });

  test('a wrong header value is reported, not silently accepted', () => {
    const headers = new Map(HEALTHY_HEADERS);
    headers.set('x-frame-options', 'SAMEORIGIN');
    const result = evaluateOriginProbe({ status: 200, headers });
    assert({
      given: 'X-Frame-Options present but weaker than the configured DENY',
      should: 'report not-ok',
      actual: result.ok,
      expected: false,
    });
  });
});

describe('composeAlertMessage (AUTH-7.7)', () => {
  test('names every fired condition with its own runbook and any origin issue', () => {
    const message = composeAlertMessage({
      conditions: [
        {
          id: 'cleanup_missed',
          summary: 'Retention sweep last succeeded 2026-09-25T09:00:00.000Z',
          runbook: 'docs/operations/auth-delivery.md#retention-cleanup-missed',
        },
      ],
      originIssues: ['strict-transport-security: expected "...", got none'],
      runUrl: 'https://github.com/2witstudios/daisydebate/actions/runs/1',
    });
    assert({
      given: 'one fired condition and one origin-probe issue',
      should:
        'include the condition id, its runbook, the origin issue, and the run URL',
      actual: {
        hasCondition: message.includes('cleanup_missed'),
        hasRunbook: message.includes(
          'auth-delivery.md#retention-cleanup-missed',
        ),
        hasOriginIssue: message.includes('strict-transport-security'),
        hasRunUrl: message.includes('actions/runs/1'),
      },
      expected: {
        hasCondition: true,
        hasRunbook: true,
        hasOriginIssue: true,
        hasRunUrl: true,
      },
    });
  });

  test('an empty condition and issue list still composes a message (negative control never reached in main())', () => {
    assert({
      given: 'no conditions and no origin issues',
      should: 'still return the header line',
      actual: composeAlertMessage({ conditions: [], originIssues: [] }),
      expected: '🔴 AUTH-7.7 alert probe',
    });
  });
});
