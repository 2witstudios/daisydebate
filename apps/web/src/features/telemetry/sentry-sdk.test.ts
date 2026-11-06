import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

for (const condition of ['node', 'edge-light'])
  test(`installed Sentry11 ${condition} transport and propagation`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        `--conditions=${condition}`,
        new URL('./sentry-sdk.test-support.ts', import.meta.url).pathname,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    assert({
      given: 'actual SDK exercised in an isolated runtime process',
      should: 'finish without SDK errors',
      actual: [exit, stderr],
      expected: [0, ''],
    });
    if (exit !== 0) return;
    const result = JSON.parse(stdout);
    assert({
      given: 'forced upstream sampled=true with deterministic local draw',
      should:
        'suppress every routine root and children while bounding ordinary traffic',
      actual: result.recording,
      expected: {
        'POST /api/rounds/abc/check-in': false,
        'attendance.check-in': false,
        'middleware POST': false,
        'GET /api/health/ready': false,
        'GET /health/live': false,
        'ordinary-rejected': false,
        'ordinary-accepted': true,
        restored: true,
      },
    });
    const delivered = JSON.stringify(result.envelopes);
    assert({
      given:
        'real envelope transport with streamed spans and an unsampled error',
      should:
        'deliver no routine spans or private values, but preserve ordinary spans and error capture',
      actual: [
        result.envelopesContainSecret,
        delivered.includes('attendance.check-in'),
        delivered.includes('middleware POST'),
        delivered.includes('ordinary-rejected'),
        delivered.includes('ordinary-accepted'),
        delivered.includes('[scrubbed]'),
      ],
      expected: [false, false, false, false, true, true],
    });
    assert({
      given:
        'sampled parent plus non-awaited session slide and real HTTP probe',
      should:
        'produce a matching healthy receipt, suppress both outgoing spans, restore sibling context and propagate no trace headers',
      actual: [
        result.healthy,
        result.slideFinished,
        result.calls.map((call: { recording: boolean }) => call.recording),
        result.received.length,
        result.received
          .slice(-2)
          .every(
            (call: {
              sentryTrace: unknown;
              baggage: unknown;
              traceparent: unknown;
            }) =>
              call.sentryTrace === null &&
              call.baggage === null &&
              call.traceparent === null,
          ),
      ],
      expected: [true, true, [false, false], 4, true],
    });
  });
