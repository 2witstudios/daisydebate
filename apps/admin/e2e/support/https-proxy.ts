import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as proxyRequest } from 'node:http';
import { createServer } from 'node:https';
import { e2eAdmin } from './operator-api-fixture';

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
const server = createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  (request, response) => {
    if (request.url === '/proxy-ready') {
      response.end('ready');
      return;
    }
    const upstream = proxyRequest(
      {
        hostname: 'localhost',
        port: e2eAdmin.backendPort,
        path: request.url,
        method: request.method,
        headers: {
          ...request.headers,
          host: new URL(e2eAdmin.origin).host,
          'x-forwarded-proto': 'https',
        },
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.once('error', () => response.destroy());
        result.pipe(response);
      },
    );
    upstream.once('error', () => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(503);
      response.end('Backend not ready');
    });
    request.pipe(upstream);
  },
);
server.listen(e2eAdmin.port, 'localhost');
const stop = () => {
  server.closeAllConnections();
  server.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
