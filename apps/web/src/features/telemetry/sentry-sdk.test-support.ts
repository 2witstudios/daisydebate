import * as Sentry from '@sentry/nextjs';
import { initSentry, fetchWithoutTracing } from './sentry-init';
import { createPublicCheckInProbe } from '../availability/public-probe';

const envelopes: unknown[] = [];
let localDraw = 0;
const spanSecret = ['span', 'secret'].join('-');
const errorSecret = ['error', 'secret'].join('-');
const received: Array<{
  path: string;
  sentryTrace: string | null;
  baggage: string | null;
  traceparent: string | null;
}> = [];
const network = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    received.push({
      path,
      sentryTrace: request.headers.get('sentry-trace'),
      baggage: request.headers.get('baggage'),
      traceparent: request.headers.get('traceparent'),
    });
    return Response.json({
      version: 1,
      commandId: 'd'.repeat(24),
      roundId: 'a'.repeat(24),
      segmentId: 'b'.repeat(24),
      participantId: 'c'.repeat(24),
      receivedAt: '2026-11-06T00:00:00Z',
      resultingVersion: 1,
      replayed: true,
    });
  },
});
initSentry({
  dsn: 'https://public@example.test/1',
  environment: 'test',
  trustedOrigin: network.url.origin,
  drawTraceSample: () => localDraw,
  transport: () => ({
    send: async (envelope: unknown) => {
      envelopes.push(envelope);
      return { statusCode: 200 };
    },
    flush: async () => true,
  }),
});

const recording: Record<string, boolean> = {};
const root = async (name: string, url?: string, sampleRand = 0) =>
  Sentry.withIsolationScope(async (scope) => {
    localDraw = sampleRand;
    scope.setSDKProcessingMetadata({
      normalizedRequest: url ? { url } : {},
    });
    await Sentry.continueTrace(
      {
        sentryTrace: '12345678901234567890123456789012-1234567890123456-1',
        baggage:
          'sentry-sample_rate=1,sentry-sampled=true,sentry-sample_rand=0',
      },
      async () => {
        const current = Sentry.getCurrentScope();
        current.setPropagationContext({
          ...current.getPropagationContext(),
          sampleRand: 0,
        });
        await Sentry.startSpan({ name, parentSpan: null }, async (span) => {
          recording[name] = span.isRecording();
          await Sentry.startSpan({ name: `${name} child` }, async () => {});
        });
      },
    );
  });

await root('POST /api/rounds/abc/check-in');
await root('attendance.check-in');
await root('middleware POST', 'https://daisy.test/api/rounds/abc/check-in');
await root('GET /api/health/ready');
await root('GET /health/live');
await root('ordinary-rejected', undefined, 0.5);
await root('ordinary-accepted', undefined, 0.005);

let slideFinished = false;
const response = Promise.withResolvers<Response>();
const calls: Array<{ path: string; recording: boolean; propagation: unknown }> =
  [];
const nextId = () => 'd'.repeat(24);
const fixture = {
  origin: network.url.origin,
  roundId: 'a'.repeat(24),
  segmentId: 'b'.repeat(24),
  participantId: 'c'.repeat(24),
  cookie: 'fixture-only',
};
const probe = createPublicCheckInProbe({
  configuration: fixture,
  nextId,
  nowMs: () => 0,
  fetch: (url, init) =>
    fetchWithoutTracing(url, init, async () => {
      const path = new URL(url).pathname;
      await Sentry.startSpan({ name: `outgoing ${path}` }, async (span) => {
        calls.push({
          path,
          recording: span.isRecording(),
          propagation: Sentry.getTraceData(),
        });
      });
      if (path.endsWith('get-session')) {
        await response.promise;
        slideFinished = true;
      }
      return fetch(url, init);
    }),
});
let healthy = false;
localDraw = 0;
await Sentry.startNewTrace(async () => {
  const current = Sentry.getCurrentScope();
  current.setPropagationContext({
    ...current.getPropagationContext(),
    sampleRand: 0,
  });
  await Sentry.startSpan(
    { name: 'ordinary-parent', parentSpan: null },
    async () => {
      await Sentry.startSpan({ name: 'attendance.check-in' }, async () => {});
      await Sentry.startSpan(
        {
          name: 'HTTP POST',
          attributes: {
            'http.url': `${network.url.origin}/api/rounds/abc/check-in`,
          },
        },
        async () => {},
      );
      await Sentry.startSpan(
        {
          name: 'HTTP GET',
          attributes: { 'url.full': `${network.url.origin}/api/health/ready` },
        },
        async () => {},
      );
      await fetch(`${network.url.origin}/api/rounds/abc/check-in`);
      await fetch(`${network.url.origin}/api/health/ready`);
      await fetch(`${network.url.origin}/ordinary`);
      healthy = await probe();
      response.resolve(new Response());
      await new Promise(setImmediate);
      await Sentry.startSpan({ name: 'restored-context' }, async (span) => {
        recording.restored = span.isRecording();
      });
    },
  );
});
await Sentry.startNewTrace(async () => {
  const current = Sentry.getCurrentScope();
  current.setPropagationContext({
    ...current.getPropagationContext(),
    sampleRand: 0,
  });
  await Sentry.startSpan(
    {
      name: `GET /safe?token=${spanSecret}`,
      parentSpan: null,
      attributes: {
        'url.full': `https://daisy.test/safe?token=${spanSecret}`,
        'url.query': spanSecret,
      },
    },
    async () => {},
  );
});
Sentry.captureException(new Error(errorSecret), {
  contexts: { proof: { kind: 'unsampled-error' } },
});
await Sentry.flush(2000);
const output = JSON.stringify(envelopes);
await Sentry.close(2000);
await network.stop(true);
await Bun.write(
  Bun.stdout,
  JSON.stringify({
    recording,
    sdkEntry: import.meta.resolve('@sentry/nextjs').split('/build/')[1],
    healthy,
    slideFinished,
    calls,
    received,
    envelopeCount: envelopes.length,
    envelopesContainSecret:
      output.includes(spanSecret) || output.includes(errorSecret),
    envelopes,
  }) + '\n',
);
process.exit(0);
