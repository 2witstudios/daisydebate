import { requireTestServices } from '@daisy/config';
import { afterAll, beforeAll } from 'bun:test';
import { $, type Subprocess } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

setupRitewayBun();
requireTestServices(process.env);

// Real Next produces special prefetch answers that an HTML stand-in cannot model.
const root = resolve(import.meta.dir, '../../..');
const fixture = mkdtempSync(join(tmpdir(), 'web-gate-next-'));
const container = `daisy-web-gate-next-${process.pid}`;
const nextLog = join(fixture, 'next.log');
let next: Subprocess | undefined;
let origin = '';

const readyNextPort = async () => {
  let port = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    const log = await Bun.file(nextLog).text();
    const bound = log.match(/http:\/\/localhost:(\d+)/)?.[1];
    if (bound && log.includes('Ready in')) {
      port = bound;
      break;
    }
    if (next?.exitCode !== null) throw new Error(`Next fixture exited: ${log}`);
    await Bun.sleep(100);
  }
  if (port === '') throw new Error('Next fixture did not bind its port');
  return port;
};

beforeAll(async () => {
  chmodSync(fixture, 0o755);
  mkdirSync(join(fixture, 'app/watch/non-document'), { recursive: true });
  writeFileSync(join(fixture, 'package.json'), '{"private":true}');
  symlinkSync(
    join(root, 'apps/web/node_modules'),
    join(fixture, 'node_modules'),
  );
  writeFileSync(
    join(fixture, 'app/layout.js'),
    `
    export default function Layout({ children }) {
      return <html><body>{children}</body></html>;
    }
  `,
  );
  writeFileSync(
    join(fixture, 'app/watch/page.js'),
    `
    import { connection } from 'next/server';
    export default async function Page() {
      await connection();
      return <main>Real Next Watch document</main>;
    }
  `,
  );
  writeFileSync(
    join(fixture, 'proxy.js'),
    `
    import { NextResponse } from 'next/server';
    export function proxy() {
      const response = NextResponse.next();
      response.headers.set('x-fixture-proxy', 'ran');
      return response;
    }
    export const config = { matcher: ['/watch/:path*'] };
  `,
  );
  writeFileSync(
    join(fixture, 'app/watch/non-document/route.js'),
    `
    export const dynamic = 'force-dynamic';
    export async function GET() {
      return Response.json({ marker: 'real-next-non-document' });
    }
  `,
  );
  const cli = join(root, 'apps/web/node_modules/next/dist/bin/next');
  await $`NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 bun ${cli} build ${fixture} --webpack`
    .cwd(fixture)
    .quiet();
  next = Bun.spawn(
    ['bun', cli, 'start', fixture, '--port', '0', '--hostname', '0.0.0.0'],
    {
      cwd: fixture,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdout: Bun.file(nextLog),
      stderr: Bun.file(nextLog),
    },
  );
  const port = await readyNextPort();
  await $`docker build -q -f apps/web/Dockerfile --target web-gate -t daisy-web-gate-proof .`
    .cwd(root)
    .quiet();
  const hosts =
    await $`docker run --rm --add-host host.docker.internal:host-gateway daisy-web-gate-proof getent ahostsv4 host.docker.internal`.text();
  const host = hosts.trim().split(/\s+/)[0]!;
  const template = await Bun.file(
    join(root, 'apps/web/gate/nginx.conf.template'),
  ).text();
  writeFileSync(
    join(fixture, 'nginx.conf'),
    template
      .replaceAll('GATEWAY_ADDRESS', host)
      .replaceAll('127.0.0.1:WEB_PORT', `${host}:${port}`),
  );
  await $`docker run -d --name ${container} --user 1001:1001 --add-host host.docker.internal:host-gateway -p 127.0.0.1::8080 -v ${fixture}:/fixture:ro daisy-web-gate-proof bash -c 'mkdir -p /tmp/web-gate; exec nginx -e /dev/stderr -c /fixture/nginx.conf -g "daemon off;"'`.quiet();
  const mapped = await $`docker port ${container} 8080`.quiet().nothrow();
  if (mapped.exitCode !== 0)
    throw new Error(
      `Next gate failed: ${await $`docker logs ${container}`.text()}`,
    );
  origin = `http://${mapped.stdout.toString().trim().split('\n')[0]}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await fetch(`${origin}/api/health/live`).catch(() => null)) !== null)
      return;
    await Bun.sleep(100);
  }
  throw new Error('Next fixture gate did not start');
}, 300_000);

afterAll(async () => {
  await $`docker rm -f ${container}`.quiet().nothrow();
  if (next) {
    next.kill('SIGTERM');
    const deadline = setTimeout(() => next?.kill('SIGKILL'), 2500);
    await next.exited;
    clearTimeout(deadline);
  }
  rmSync(fixture, { recursive: true, force: true });
}, 10_000);

const load = async (
  path: string,
  cookie: string,
  headers: Record<string, string> = {},
) => {
  const response = await fetch(`${origin}${path}`, {
    headers: { cookie: `fixture=${cookie}`, ...headers },
    redirect: 'manual',
  });
  return { response, body: await response.text() };
};
const isDocument = ({ response, body }: Awaited<ReturnType<typeof load>>) =>
  response.status === 200 &&
  response.headers.get('content-type')?.startsWith('text/html') === true &&
  body.includes('Real Next Watch document');

test('ordinary real Next Watch documents are cached', async () => {
  const first = await load('/watch', 'plain');
  const second = await load('/watch', 'plain');
  assert({
    given: 'two ordinary anonymous requests through nginx to real Next',
    should: 'render HTML once and serve the next document from cache',
    actual: [
      isDocument(first),
      isDocument(second),
      first.response.headers.get('x-gate-cache'),
      second.response.headers.get('x-gate-cache'),
    ],
    expected: [true, true, 'MISS', 'HIT'],
  });
});

test('real Next prefetch variants cannot read or fill a document cache key', async () => {
  for (const header of [
    'x-middleware-prefetch',
    'next-router-prefetch',
    'next-router-segment-prefetch',
    'rsc',
  ]) {
    for (const value of ['1', '0']) {
      const cookie = `${header}-${value}`;
      const first = await load('/watch', cookie, { [header]: value });
      const document = await load('/watch', cookie);
      const after = await load('/watch', cookie, { [header]: value });
      assert({
        given: `${header}: ${value} before and after an ordinary Next document`,
        should: 'bypass both reads and writes while preserving ordinary HTML',
        actual: [
          first.response.headers.get('x-gate-cache'),
          document.response.headers.get('x-gate-cache'),
          isDocument(document),
          after.response.headers.get('x-gate-cache'),
        ],
        expected: ['BYPASS', 'MISS', true, 'BYPASS'],
      });
      if (header === 'x-middleware-prefetch')
        assert({
          given: `real Next receiving middleware prefetch ${value}`,
          should:
            'exercise its actual short-circuit response rather than a stand-in',
          actual: [first.body, first.response.headers.get('x-middleware-skip')],
          expected: ['{}', '1'],
        });
    }
  }
}, 30_000);

test('real Next JSON responses never populate the HTML document cache', async () => {
  const first = await load('/watch/non-document', 'json');
  const second = await load('/watch/non-document', 'json');
  assert({
    given: 'two unhinted requests to a real Next JSON response',
    should: 'read upstream both times despite status 200',
    actual: [
      first.response.headers.get('x-gate-cache'),
      second.response.headers.get('x-gate-cache'),
      JSON.parse(second.body),
    ],
    expected: ['MISS', 'MISS', { marker: 'real-next-non-document' }],
  });
});
