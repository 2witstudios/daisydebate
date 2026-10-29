import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Ephemeral, local test key only; no certificates or keys enter the repository.
const directory = mkdtempSync(join(tmpdir(), 'daisy-admin-https-'));
const key = join(directory, 'key.pem');
const cert = join(directory, 'cert.pem');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost',
  ],
  { stdio: 'ignore' },
);
const server = Bun.serve({
  hostname: 'localhost',
  port: 4800,
  tls: { key: readFileSync(key), cert: readFileSync(cert) },
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/proxy-ready') return new Response('ready');
    const upstream = new URL(
      url.pathname + url.search,
      'http://localhost:4802',
    );
    const headers = new Headers(request.headers);
    headers.set('host', 'localhost:4800');
    headers.set('x-forwarded-proto', 'https');
    return fetch(upstream, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method)
        ? null
        : await request.arrayBuffer(),
      redirect: 'manual',
    });
  },
});
const stop = () => {
  server.stop(true);
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
