import { afterAll, beforeAll } from 'bun:test';
import { $ } from 'bun';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The real gate, script and nginx in the Dockerfile's stage, in front of a stand-in web that
 * counts what reaches it. The container's peer is its default gateway, as fly-proxy is on Fly.
 */
const standInWeb = `
export const seen = {};
process.on('SIGINT', () => {
  console.log('stand-in draining');
  setTimeout(() => {
    console.log('stand-in drained');
    process.exit(0);
  }, 250);
});
Bun.serve({
  hostname: '127.0.0.1',
  port: 8090,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__seen') return Response.json(seen);
    const key = url.pathname + url.search;
    seen[key] = (seen[key] ?? 0) + 1;
    seen['client:' + request.headers.get('fly-client-ip')] = true;
    if (url.pathname === '/watch/slow-refresh' && seen[key] > 1) await Bun.sleep(1000);
    if (request.headers.has('x-middleware-prefetch')) return new Response('{}', {
      headers: { 'content-type': 'application/json', 'x-middleware-skip': '1', 'cache-control': 'private, no-store' },
    });
    const headers = { 'content-type': 'text/html', 'cache-control': 'private, no-store', 'x-web-process': String(process.pid) };
    if (url.pathname === '/watch/sets-cookie') headers['set-cookie'] = 'a=b';
    return new Response('page ' + key + ' ' + seen[key], { headers });
  },
});
`;

export const container = `daisy-web-gate-proof-${process.pid}`;
let origin = '';
let web = '';
export const containers = [
  container,
  `${container}-shutdown`,
  `${container}-deaths`,
];
export const startContainer = async (name: string) => {
  await $`docker run -d --name ${name} --user 1001:1001 -p 127.0.0.1::8080 -e PORT=8090 -v ${web}/src:/app/apps/web/src:ro -w /app/apps/web daisy-web-gate-proof bash gate/start.sh`.quiet();
  const mapped = (await $`docker port ${name} 8080`.text()).trim();
  const address = `http://${mapped.split('\n')[0]}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await fetch(`${address}/api/health/live`).catch(() => null);
    if (ready?.ok) return address;
    await Bun.sleep(100);
  }
  throw new Error('The web gate did not start');
};
export const master = async (name = container) =>
  (
    await $`docker exec ${name} cat /tmp/web-gate/nginx.pid`.quiet().text()
  ).trim();
export const killMaster = async (name: string, pid: string) => {
  await $`docker exec ${name} bash -c 'kill -9 "$1"' bash ${pid}`.quiet();
};
export const replacementMaster = async (name: string, previous: string) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    await Bun.sleep(100);
    const next = await master(name).catch(() => '');
    if (next !== '' && next !== previous) return next;
  }
  return '';
};
export const exited = async (name: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const running = (
      await $`docker inspect -f '{{.State.Running}}' ${name}`.text()
    ).trim();
    if (running === 'false')
      return (await $`docker wait ${name}`.text()).trim();
    await Bun.sleep(100);
  }
  return 'still running';
};

beforeAll(async () => {
  web = mkdtempSync(join(tmpdir(), 'web-gate-'));
  mkdirSync(join(web, 'src/server'), { recursive: true });
  writeFileSync(join(web, 'src/server/start.ts'), standInWeb);
  await $`docker build -q -f apps/web/Dockerfile --target web-gate -t daisy-web-gate-proof .`
    .cwd(join(import.meta.dir, '../../..'))
    .quiet();
  origin = await startContainer(container);
}, 300_000);

afterAll(async () => {
  await $`docker rm -f ${containers}`.quiet().nothrow();
  rmSync(web, { recursive: true, force: true });
});

export const seen = async (key: string) => {
  const read =
    "console.log(await (await fetch('http://127.0.0.1:8090/__seen')).text())";
  const counts = JSON.parse(
    await $`docker exec ${container} bun -e ${read}`.text(),
  ) as Record<string, number | boolean>;
  return counts[key] ?? 0;
};
export const load = (
  path: string,
  init: RequestInit = {},
  client = '203.0.113.1',
) =>
  fetch(`${origin}${path}`, {
    ...init,
    headers: { 'fly-client-ip': client, ...init.headers },
  });
export const loadMany = (
  count: number,
  path: string,
  init?: RequestInit,
  client?: string,
) => Promise.all(Array.from({ length: count }, () => load(path, init, client)));
