import * as Sentry from '@sentry/bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { initRealtimeSentry } from './init-sentry';
setupRitewayBun();

test('installed Bun SDK bounds inherited sampling and scrubs its actual streamed envelopes', async () => {
  const envelopes: unknown[] = [];
  let localDraw = 0;
  initRealtimeSentry({
    dsn: 'https://public@example.test/1',
    environment: 'test',
    drawTraceSample: () => localDraw,
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  const recording: boolean[] = [];
  for (const [name, draw] of [
    ['GET /health/ready', 0],
    ['attendance.check-in', 0],
    ['ordinary-rejected', 0.5],
    ['ordinary-accepted', 0.005],
  ] as const) {
    localDraw = draw;
    await Sentry.continueTrace(
      {
        sentryTrace: '12345678901234567890123456789012-1234567890123456-1',
        baggage:
          'sentry-sample_rate=1,sentry-sampled=true,sentry-sample_rand=0',
      },
      async () => {
        const scope = Sentry.getCurrentScope();
        scope.setPropagationContext({
          ...scope.getPropagationContext(),
          sampleRand: 0,
        });
        await Sentry.startSpan({ name }, async (span) => {
          recording.push(span.isRecording());
        });
      },
    );
  }
  const marker = ['private', 'value'].join('-');
  Sentry.captureException(new Error(marker));
  await Sentry.flush(2000);
  await Sentry.close(2000);
  const output = JSON.stringify(envelopes);
  assert({
    given: 'actual Bun SDK with forced sampled upstream parents',
    should: 'record only the locally admitted ordinary trace',
    actual: recording,
    expected: [false, false, false, true],
  });
  assert({
    given: 'its actual envelope transport',
    should:
      'keep complete error reporting and scrub messages without routine spans',
    actual: [
      output.includes('[scrubbed]'),
      output.includes(marker),
      output.includes('attendance.check-in'),
      output.includes('ordinary-rejected'),
      output.includes('ordinary-accepted'),
    ],
    expected: [true, false, false, false, true],
  });
});
