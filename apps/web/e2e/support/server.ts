import { systemClock, systemId } from '@daisy/clock';
import { createApp } from '../../src/server/app';
import { adoptProcessApp } from '../../src/server/process-app';
import { createMailCapture } from './mail-capture';
import { openRouterStub } from './openrouter-stub';
import { createSelfSignedTlsEdge } from './tls-edge';

/**
 * The browser suite's production server, with exactly three additions around it
 * and nothing inside it:
 *   1. the outbound mail transport is captured (the real Resend sender runs
 *      unchanged; only its HTTP call is answered locally), readable at
 *      `GET /mails?to=<address>` on the loopback capture port;
 *   2. a loopback TLS edge, because production configuration requires an
 *      HTTPS origin and a real browser needs it for Secure cookies;
 *   3. OpenRouter (AI debates) answered by a local stub, never the network.
 * Test-only: nothing under src/ imports it.
 */
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const appPort = Number(env('PORT'));
const edgePort = Number(env('E2E_EDGE_PORT'));
const mailPort = Number(env('E2E_MAIL_PORT'));

const mailCapture = createMailCapture({
  port: mailPort,
  redisUrl: env('REDIS_URL'),
  redisNamespace: env('REDIS_NAMESPACE'),
});

// The production server below runs this app: the real environment, with
// only its mail transport captured. Nothing process-wide is replaced.
adoptProcessApp(
  createApp({
    env: process.env,
    // OpenRouter (AI debates) is answered locally; everything else goes
    // through the mail capture.
    fetch: async (input, init) =>
      openRouterStub(input, init) ?? mailCapture.captureFetch(input, init),
    clock: systemClock,
    ids: systemId,
  }),
);

createSelfSignedTlsEdge({ appPort, edgePort });

// ISSUE-279: this process's event-loop delay, one log line a second, so a
// stalled test's evidence shows whether our server was starved in the
// window (a starved or stopped server writes no line at all). Timer drift,
// not monitorEventLoopDelay: Bun's histogram misses a blocked loop.
let lastTick = performance.now();
let worstDelay = 0;
setInterval(() => {
  const now = performance.now();
  worstDelay = Math.max(worstDelay, now - lastTick - 100);
  lastTick = now;
}, 100).unref();
setInterval(() => {
  process.stdout.write(
    `${JSON.stringify({ time: Math.round(performance.timeOrigin + performance.now()), event: 'e2e.event_loop', maxDelayMs: Math.round(worstDelay) })}\n`,
  );
  worstDelay = 0;
}, 1_000).unref();

await import('../../src/server/start');
// The app drains and closes its own resources on these signals; the capture
// and edge listeners must not keep the process alive after that.
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    setTimeout(() => process.exit(0), 3000);
  });
