import { afterAll, beforeAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { $ } from 'bun';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

setupRitewayBun();

/**
 * The real gate, script and nginx in the Dockerfile's stage, in front of a stand-in web that
 * counts what reaches it. The container's peer is its default gateway, as fly-proxy is on Fly.
 */
const standInWeb = `
const seen = {};
Bun.serve({
  hostname: '127.0.0.1',
  port: 8090,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__seen') return Response.json(seen);
    const key = url.pathname + url.search;
    seen[key] = (seen[key] ?? 0) + 1;
    seen['client:' + request.headers.get('fly-client-ip')] = true;
    const headers = { 'content-type': 'text/html', 'cache-control': 'private, no-store' };
    if (url.pathname === '/watch/sets-cookie') headers['set-cookie'] = 'a=b';
    return new Response('page ' + key + ' ' + seen[key], { headers });
  },
});
`;

const container = `daisy-web-gate-proof-${process.pid}`;
let origin = '';

beforeAll(async () => {
  const web = mkdtempSync(join(tmpdir(), 'web-gate-'));
  mkdirSync(join(web, 'src/server'), { recursive: true });
  writeFileSync(join(web, 'src/server/start.ts'), standInWeb);
  await $`docker build -q -f apps/web/Dockerfile --target web-gate -t daisy-web-gate-proof .`
    .cwd(join(import.meta.dir, '../../..'))
    .quiet();
  await $`docker run -d --rm --name ${container} -p 127.0.0.1::8080 -e PORT=8090 -v ${web}/src:/app/apps/web/src:ro -w /app/apps/web daisy-web-gate-proof bash gate/start.sh`.quiet();
  const mapped = (await $`docker port ${container} 8080`.text()).trim();
  origin = `http://${mapped.split('\n')[0]}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await fetch(`${origin}/api/health/live`).catch(() => null);
    if (ready?.ok) return;
    await Bun.sleep(100);
  }
  throw new Error('The web gate did not start');
}, 300_000);

afterAll(async () => {
  await $`docker rm -f ${container}`.quiet().nothrow();
});

const seen = async (key: string) => {
  const read =
    "console.log(await (await fetch('http://127.0.0.1:8090/__seen')).text())";
  const counts = JSON.parse(
    await $`docker exec ${container} bun -e ${read}`.text(),
  ) as Record<string, number | boolean>;
  return counts[key] ?? 0;
};
const load = (path: string, init: RequestInit = {}, client = '203.0.113.1') =>
  fetch(`${origin}${path}`, {
    ...init,
    headers: { 'fly-client-ip': client, ...init.headers },
  });
const loadMany = (
  count: number,
  path: string,
  init?: RequestInit,
  client?: string,
) => Promise.all(Array.from({ length: count }, () => load(path, init, client)));

test("an anonymous Watch page is web's work once, however many load it", async () => {
  await loadMany(30, '/watch/cached', undefined, '203.0.113.2');
  assert({
    given: '30 loads of an anonymous Watch page inside its 5 s',
    should: 'reach web once',
    actual: await seen('/watch/cached'),
    expected: 1,
  });
});

test('nothing private or different is served from the cache', async () => {
  const session = { cookie: 'better-auth.session_token=a' };
  await load('/watch/held', { headers: session }, '203.0.113.3');
  await load('/watch/held', { headers: session }, '203.0.113.3');
  const secure = { cookie: 'x=1; __Secure-better-auth.session_token=a' };
  await load('/watch/secure', { headers: secure }, '203.0.113.3');
  await load('/watch/secure', { headers: secure }, '203.0.113.3');
  const link = { cookie: 'daisy_audience_link_r1=t' };
  await load('/watch/r1', { headers: link }, '203.0.113.3');
  await load('/watch/r1', { headers: link }, '203.0.113.3');
  await load('/watch/sets-cookie', {}, '203.0.113.3');
  await load('/watch/sets-cookie', {}, '203.0.113.3');
  await load('/watch/query?a=1', {}, '203.0.113.3');
  await load('/watch/query?a=1', {}, '203.0.113.3');
  await load('/watch/client-nav', { headers: { rsc: '1' } }, '203.0.113.3');
  await load('/watch/client-nav', { headers: { rsc: '1' } }, '203.0.113.3');
  const one = await (await load('/watch/round-a', {}, '203.0.113.3')).text();
  const two = await (await load('/watch/round-b', {}, '203.0.113.3')).text();
  const plain = await (await load('/watch/cookies', {}, '203.0.113.3')).text();
  const other = await (
    await load(
      '/watch/cookies',
      { headers: { cookie: 'daisy-theme=dark' } },
      '203.0.113.3',
    )
  ).text();
  assert({
    given:
      'a session cookie, a secure session cookie, an audience link, Set-Cookie, a query or a client navigation',
    should: 'reach web every time',
    actual: await Promise.all(
      [
        '/watch/held',
        '/watch/secure',
        '/watch/r1',
        '/watch/sets-cookie',
        '/watch/query?a=1',
        '/watch/client-nav',
      ].map(seen),
    ),
    expected: [2, 2, 2, 2, 2, 2],
  });
  assert({
    given: 'two Rounds',
    should: 'never answer one with the other',
    actual: [
      one.startsWith('page /watch/round-a'),
      two.startsWith('page /watch/round-b'),
    ],
    expected: [true, true],
  });
  assert({
    given: 'the same page with different cookies',
    should: 'keep separate copies',
    actual: [plain.endsWith(' 1'), other.endsWith(' 2')],
    expected: [true, true],
  });
});

test('one address past its budget is refused before web', async () => {
  const refused = (
    await loadMany(400, '/other', undefined, '203.0.113.4')
  ).filter((response) => response.status === 429);
  assert({
    given: 'one address sending 400 anonymous requests at once',
    should: 'refuse most with 429 and say when to return',
    actual: [refused.length > 300, refused[0]?.headers.get('retry-after')],
    expected: [true, '2'],
  });
  const member = await load(
    '/api/rounds/seat',
    { headers: { cookie: 'better-auth.session_token=a' } },
    '203.0.113.5',
  );
  assert({
    given: 'a member at another address during that',
    should: 'still reach web',
    actual: member.status,
    expected: 200,
  });
  const neighbour = await load('/other', {}, '203.0.113.6');
  assert({
    given: 'a different address named by fly-proxy',
    should: 'keep its own budget',
    actual: neighbour.status !== 429,
    expected: true,
  });
});

test('a crowd from many addresses is paced, and a seat does not wait behind it', async () => {
  const crowd = Array.from({ length: 300 }, (_, index) =>
    load(`/crowd/${index}`, {}, `198.51.100.${(index % 250) + 1}`),
  );
  const member = await load(
    '/api/rounds/seat-in-crowd',
    { headers: { cookie: 'better-auth.session_token=a' } },
    '203.0.113.7',
  );
  const answered = await Promise.all(crowd);
  assert({
    given: '300 anonymous misses from 250 addresses',
    should: 'refuse what the lane cannot hold, and say when to return',
    actual: [
      answered.filter((response) => response.status === 503).length >= 200,
      answered
        .find((response) => response.status === 503)
        ?.headers.get('retry-after'),
    ],
    expected: [true, '2'],
  });
  assert({
    given: 'a seat during that crowd',
    should: 'reach web',
    actual: member.status,
    expected: 200,
  });
});

test('web learns the caller from fly-proxy only', async () => {
  await load(
    '/api/rounds/named',
    { headers: { cookie: 'better-auth.session_token=a' } },
    '203.0.113.8',
  );
  assert({
    given: 'the machine gateway naming a caller',
    should: 'hand web that address',
    actual: await seen('client:203.0.113.8'),
    expected: true,
  });
  const forged =
    await $`docker run --rm --network container:${container} daisy-web-gate-proof bun -e ${"const r = await fetch('http://127.0.0.1:8080/api/rounds/forged', { headers: { 'fly-client-ip': '203.0.113.99', cookie: 'better-auth.session_token=a' } }); console.log(r.status)"}`.text();
  assert({
    given: 'a peer that is not the gateway claiming an address',
    should: 'not hand web the claim',
    actual: [forged.trim(), await seen('client:203.0.113.99')],
    expected: ['200', 0],
  });
});

test('a gate that dies comes back without touching web', async () => {
  await $`docker exec ${container} bash -c 'kill -9 $(cat /tmp/web-gate/nginx.pid)'`.quiet();
  let back = 0;
  for (let attempt = 0; attempt < 50 && back !== 200; attempt++) {
    await Bun.sleep(200);
    back = (await load('/api/health/live').catch(() => null))?.status ?? 0;
  }
  const logs = await $`docker logs ${container}`.text();
  assert({
    given: 'the gate killed',
    should: 'answer again and log the restart',
    actual: [back, logs.includes('web_gate.restarted')],
    expected: [200, true],
  });
});
