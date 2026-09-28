import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  composeAlertMessage,
  decideProbeOutcome,
  evaluateOriginProbe,
  fetchAlertConditions,
  resolveProbeConfig,
  resolveProbeToken,
} from './auth-alert-probe';

setupRitewayBun();

const SCRIPT_PATH = join(import.meta.dir, 'auth-alert-probe.ts');

/**
 * Runs the real script as a subprocess — the only way to prove `main()`
 * itself refuses, since it calls `process.exit` directly and cannot be
 * invoked in-process without killing the test runner. Port 1 on localhost
 * refuses the connection immediately (no DNS lookup, no timeout), so a
 * regression that proceeds past the refusal check still fails fast rather
 * than hanging.
 */
function spawnProbe(args: readonly string[]) {
  return Bun.spawnSync(['bun', SCRIPT_PATH, ...args], {
    env: { PATH: process.env.PATH ?? '' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('resolveProbeToken (ISSUE-144)', () => {
  test('reads the bearer token from the environment', () => {
    assert({
      given: 'an environment with OPS_PROBE_TOKEN set',
      should: 'return that value',
      actual: resolveProbeToken({ OPS_PROBE_TOKEN: 'env-value' }),
      expected: 'env-value',
    });
  });

  test('takes no command-line arguments, so a --token flag can never reach it', () => {
    // resolveProbeToken's only parameter is the environment record — there
    // is no args parameter for a --token flag to occupy, so this call site
    // is itself proof the flag is no longer accepted; TypeScript would
    // refuse a second argument if one were added back.
    assert({
      given: "resolveProbeToken's exported signature",
      should: 'accept exactly one parameter (the environment)',
      actual: resolveProbeToken.length,
      expected: 1,
    });
  });
});

describe('resolveProbeConfig (ISSUE-144, NC24 regression guard)', () => {
  test('refuses a --token flag with no OPS_PROBE_TOKEN in the environment', () => {
    // If main (or its arg parser) ever read --token as a fallback source
    // again, this would resolve a config instead of refusing.
    assert({
      given: '--origin and --token on the command line, no OPS_PROBE_TOKEN set',
      should: 'refuse (return undefined) rather than accept the --token value',
      actual: resolveProbeConfig(
        ['--origin', 'https://example.test', '--token', 'sneaky-value'],
        {},
      ),
      expected: undefined,
    });
  });

  test('uses OPS_PROBE_TOKEN from the environment, ignoring an unrelated --token flag', () => {
    assert({
      given:
        'OPS_PROBE_TOKEN in the environment and a --token flag with a different value',
      should:
        'resolve a config carrying the environment value, never the flag value',
      actual: resolveProbeConfig(
        ['--origin', 'https://example.test', '--token', 'ignored-value'],
        { OPS_PROBE_TOKEN: 'real-value' },
      ),
      expected: {
        origin: 'https://example.test',
        token: 'real-value',
        runUrl: undefined,
      },
    });
  });
});

describe('main() (AUTH-7.15, NC24/NC26 regression guard)', () => {
  test('exits 2 with the usage error and sends no request, given --token but no OPS_PROBE_TOKEN', () => {
    // Drives the real script, not resolveProbeConfig in isolation: a
    // rewrite of main() that stops calling resolveProbeConfig at all (NC26)
    // or one that reintroduces --token as a fallback inside it (NC24) both
    // change this process's observable exit code and stderr, so either
    // regression fails this test regardless of which function it lives in.
    const result = spawnProbe([
      '--origin',
      'http://127.0.0.1:1',
      '--token',
      'sneaky-value',
    ]);
    assert({
      given: '--origin and --token on the command line, no OPS_PROBE_TOKEN set',
      should: 'exit 2 with the usage error, never reaching a fetch',
      actual: {
        exitCode: result.exitCode,
        stderrHasUsage: result.stderr.toString().includes('usage:'),
      },
      expected: { exitCode: 2, stderrHasUsage: true },
    });
  });
});

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

describe('fetchAlertConditions (ISSUE-156)', () => {
  test('returns the conditions from a healthy 200 response', async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          conditions: [
            {
              id: 'cleanup_missed',
              summary: 'x',
              runbook:
                'docs/operations/auth-delivery.md#retention-cleanup-missed',
            },
          ],
        }),
    });
    const result = await fetchAlertConditions(
      `http://127.0.0.1:${server.port}`,
      'token',
    );
    assert({
      given: 'a healthy /api/ops/alerts response',
      should: 'resolve ok with the conditions',
      actual: result,
      expected: {
        ok: true,
        conditions: [
          {
            id: 'cleanup_missed',
            summary: 'x',
            runbook:
              'docs/operations/auth-delivery.md#retention-cleanup-missed',
          },
        ],
      },
    });
  });

  test('a non-2xx response from /api/ops/alerts resolves not-ok naming the status, never throws', async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response('down', { status: 500 }),
    });
    const result = await fetchAlertConditions(
      `http://127.0.0.1:${server.port}`,
      'token',
    );
    assert({
      given:
        'a 500 from /api/ops/alerts (e.g. Redis is unreachable server-side)',
      should: 'resolve not-ok naming the status, not throw',
      actual: result,
      expected: { ok: false, error: '/api/ops/alerts responded 500' },
    });
  });

  test('a 2xx body without a conditions array resolves not-ok, never ok with undefined conditions', async () => {
    using server = Bun.serve({ port: 0, fetch: () => Response.json({}) });
    const result = await fetchAlertConditions(
      `http://127.0.0.1:${server.port}`,
      'token',
    );
    assert({
      given: 'a 200 from /api/ops/alerts whose JSON has no conditions array',
      should: 'resolve not-ok naming the malformed body, not ok',
      actual: result,
      expected: {
        ok: false,
        error: '/api/ops/alerts responded without a conditions array',
      },
    });
  });

  test('a refused connection resolves not-ok naming the failure, never throws', async () => {
    const result = await fetchAlertConditions('http://127.0.0.1:1', 'token');
    assert({
      given: '/api/ops/alerts entirely unreachable (connection refused)',
      should: 'resolve not-ok, not throw',
      actual: result.ok,
      expected: false,
    });
  });
});

describe('decideProbeOutcome (ISSUE-156)', () => {
  const HEALTHY_ORIGIN = { ok: true, issues: [] };

  test('healthy origin and no fired conditions is healthy', () => {
    assert({
      given: 'a healthy origin probe and zero fired conditions',
      should: 'report healthy with no message',
      actual: decideProbeOutcome({
        originProbe: HEALTHY_ORIGIN,
        alertConditions: { ok: true, conditions: [] },
      }),
      expected: { healthy: true, message: null },
    });
  });

  test('an unreachable /api/ops/alerts is not-healthy and still produces a postable message, independent of the failing dependency', () => {
    const outcome = decideProbeOutcome({
      originProbe: HEALTHY_ORIGIN,
      alertConditions: {
        ok: false,
        error: '/api/ops/alerts request failed: fetch failed',
      },
    });
    assert({
      given:
        'a healthy origin but an unreachable /api/ops/alerts (Redis fully down)',
      should:
        'report not-healthy with a message naming the unreachable dependency, so posting to Incidents never depends on it answering',
      actual: {
        healthy: outcome.healthy,
        namesFailure:
          outcome.message?.includes('alert conditions unavailable') ?? false,
      },
      expected: { healthy: false, namesFailure: true },
    });
  });

  test('fired conditions with a healthy origin are not-healthy and named in the message', () => {
    const outcome = decideProbeOutcome({
      originProbe: HEALTHY_ORIGIN,
      alertConditions: {
        ok: true,
        conditions: [
          {
            id: 'limiter_unavailable',
            summary: 'x',
            runbook:
              'docs/operations/auth-delivery.md#storage-or-rate-limiter-unavailable',
          },
        ],
      },
    });
    assert({
      given: 'a fired condition from a healthy /api/ops/alerts read',
      should: 'report not-healthy naming the condition',
      actual: {
        healthy: outcome.healthy,
        namesCondition:
          outcome.message?.includes('limiter_unavailable') ?? false,
      },
      expected: { healthy: false, namesCondition: true },
    });
  });
});
