import { createServer, request } from 'node:http';
import { chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { createMailCapture } from './mail-capture';
import type { Fetch } from '../../src/features/auth/mail/mail';
import { resendRequest } from '../../src/features/auth/mail/resend-capture.test-support';

export const launchMailPath = (id: string) => join(tmpdir(), `drm-${id}.sock`);
const message = z.strictObject({
  to: z.string().max(320),
  subject: z.string().max(1024),
  text: z.string().max(65536),
});
/** One fixture-owned mailbox survives either application's graceful rolling restart. */
export function createLaunchMail(input: {
  readonly path: string;
  readonly port: number;
  readonly redisUrl: string;
  readonly redisNamespace: string;
}) {
  const capture = createMailCapture(input);
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/capture') {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 131072)
          throw new Error('Mail capture limit');
      }
      const sent = message.parse(JSON.parse(body));
      const answer = await capture.captureFetch(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          body: JSON.stringify({ ...sent, to: [sent.to] }),
        },
      );
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(await answer.text());
    } catch {
      res.writeHead(400).end();
    }
  });
  const started = new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      chmodSync(input.path, 0o600);
      accept();
    });
  });
  server.once('close', () => rmSync(input.path, { force: true }));
  server.listen(`${input.path}`);
  return {
    started,
    mails: capture.mails,
    async stop() {
      await capture.stop(true);
      await new Promise<void>((accept) => {
        server.close(() => accept());
        server.closeAllConnections();
      });
    },
  };
}
/** Only the captured Resend payload crosses the owned socket; vendor credentials never do. */
export const launchMailFetch =
  (path: string): Fetch =>
  (input: string | URL | Request, init?: RequestInit) => {
    const sent = resendRequest(input, init);
    if (!sent) return globalThis.fetch(input, init);
    const body = JSON.stringify(
      message.parse({ to: sent.to, subject: sent.subject, text: sent.text }),
    );
    return new Promise<Response>((accept, reject) => {
      const call = request(
        { socketPath: path, path: '/capture', method: 'POST' },
        (response) => {
          let answer = '';
          response.on('data', (chunk) => {
            answer += chunk;
          });
          response.once('end', () =>
            accept(
              new Response(answer, {
                status: response.statusCode ?? 503,
                headers: { 'content-type': 'application/json' },
              }),
            ),
          );
          response.once('error', reject);
        },
      );
      call.setTimeout(10000, () =>
        call.destroy(new Error('Mail capture deadline')),
      );
      call.once('error', reject);
      call.end(body);
    });
  };
