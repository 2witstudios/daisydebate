import { RedisClient } from 'bun';
import { mkdirSync, readFileSync } from 'node:fs';

/**
 * The browser suite's production server, with exactly two additions around it
 * and nothing inside it:
 *   1. the outbound mail transport is captured (the real Resend sender runs
 *      unchanged; only its HTTP call is answered locally), readable at
 *      `GET /mails?to=<address>` on the loopback capture port;
 *   2. a loopback TLS edge, because production configuration requires an
 *      HTTPS origin and a real browser needs it for Secure cookies.
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
const namespace = env('REDIS_NAMESPACE');

type Captured = { to: string; subject: string; text: string };
const mails: Captured[] = [];
const realFetch = globalThis.fetch;
// Installed before the app boots so the server's own fetch wraps this one.
globalThis.fetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== 'https://api.resend.com/emails') return realFetch(input, init);
  const body = JSON.parse(String(init?.body)) as {
    to: string[];
    subject: string;
    text: string;
  };
  mails.push({
    to: (body.to[0] ?? '').toLowerCase(),
    subject: body.subject,
    text: body.text,
  });
  return Response.json({ id: `msg_e2e_${mails.length}` });
}) as typeof fetch;

/** Rate-limit buckets are keyed by client, and the browser is one client. */
const resetRateLimits = async () => {
  const client = new RedisClient(env('REDIS_URL'));
  try {
    const keys = (await client.send('KEYS', [`${namespace}:*`])) as string[];
    for (const key of keys) await client.del(key);
  } finally {
    client.close();
  }
};

Bun.serve({
  hostname: '127.0.0.1',
  port: mailPort,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/mails') {
      const to = (url.searchParams.get('to') ?? '').toLowerCase();
      return Response.json(mails.filter((mail) => mail.to === to));
    }
    if (url.pathname === '/reset' && request.method === 'POST') {
      await resetRateLimits();
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  },
});

// A throwaway self-signed certificate for localhost, created per run, in a
// directory of its own port so concurrent suites never mix key and cert.
const certDir = `test-results/e2e-tls-${edgePort}`;
mkdirSync(certDir, { recursive: true });
const made = Bun.spawnSync([
  'openssl',
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-days',
  '1',
  '-keyout',
  `${certDir}/key.pem`,
  '-out',
  `${certDir}/cert.pem`,
  '-subj',
  '/CN=localhost',
  '-addext',
  'subjectAltName=DNS:localhost',
]);
if (made.exitCode !== 0) throw new Error('openssl could not create the cert');

Bun.serve({
  hostname: '127.0.0.1',
  port: edgePort,
  tls: {
    key: readFileSync(`${certDir}/key.pem`),
    cert: readFileSync(`${certDir}/cert.pem`),
  },
  async fetch(request) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-proto', 'https');
    const upstream = await realFetch(
      `http://127.0.0.1:${appPort}${url.pathname}${url.search}`,
      {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
        // @ts-expect-error Bun: stream a request body through the proxy.
        duplex: 'half',
      },
    );
    // fetch has already decoded the body, so its encoding headers are stale.
    const answered = new Headers(upstream.headers);
    answered.delete('content-encoding');
    answered.delete('content-length');
    return new Response(upstream.body, {
      status: upstream.status,
      headers: answered,
    });
  },
});

await import('../../src/server/start');
// The app drains and closes its own resources on these signals; the capture
// and edge listeners must not keep the process alive after that.
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    setTimeout(() => process.exit(0), 3000);
  });
