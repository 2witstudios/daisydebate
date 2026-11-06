import * as Sentry from '@sentry/nextjs';
import { initSentry, fetchWithoutTracing } from './sentry-init';

async function proveBrowser(untrustedUrl: string) {
  const envelopes: unknown[] = [];
  let draw = 0.5;
  initSentry({
    dsn: 'https://public@example.test/1',
    environment: 'test',
    trustedOrigin: location.origin,
    drawTraceSample: () => draw,
    transport: () => ({
      send: async (envelope: unknown) => {
        envelopes.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  const recording: boolean[] = [];
  for (const [name, localDraw] of [
    ['POST /api/rounds/abc/check-in', 0],
    ['GET /api/health/ready', 0],
    ['ordinary-rejected', 0.5],
    ['ordinary-accepted', 0.005],
  ] as const) {
    draw = localDraw;
    await Sentry.continueTrace(
      {
        sentryTrace: '12345678901234567890123456789012-1234567890123456-1',
        baggage:
          'sentry-sample_rate=1,sentry-sampled=true,sentry-sample_rand=0',
      },
      async () => {
        await Sentry.startSpan({ name, parentSpan: null }, async (span) => {
          recording.push(span.isRecording());
        });
      },
    );
  }
  draw = 0;
  let restored = false;
  await Sentry.startNewTrace(async () => {
    await Sentry.startSpan(
      { name: 'ordinary-browser-parent', parentSpan: null },
      async () => {
        await Sentry.startSpan({ name: 'attendance.check-in' }, async () => {});
        await Sentry.startSpan(
          {
            name: 'HTTP POST',
            attributes: {
              'url.full': `${location.origin}/api/rounds/abc/check-in`,
            },
          },
          async () => {},
        );
        await Sentry.startSpan(
          {
            name: 'HTTP GET',
            attributes: { 'http.url': `${location.origin}/api/health/ready` },
          },
          async () => {},
        );
        await fetch('/api/rounds/abc/check-in');
        await fetch('/api/health/ready');
        await fetchWithoutTracing(
          `${location.origin}/api/rounds/probe/check-in`,
          {},
          fetch,
        );
        await fetchWithoutTracing(
          `${location.origin}/api/auth/get-session`,
          {},
          fetch,
        );
        await fetch('/ordinary');
        await fetch(untrustedUrl);
        await Sentry.startSpan(
          { name: 'restored-browser-context' },
          async (span) => {
            restored = span.isRecording();
          },
        );
      },
    );
  });
  const marker = ['private', 'browser', 'value'].join('-');
  draw = 0.5;
  Sentry.captureException(new Error(marker));
  await Sentry.flush(2000);
  await Sentry.close(2000);
  return {
    recording,
    restored,
    envelopes,
    containsSecret: JSON.stringify(envelopes).includes(marker),
  };
}

(
  window as unknown as { proveSentryBrowser: typeof proveBrowser }
).proveSentryBrowser = proveBrowser;
