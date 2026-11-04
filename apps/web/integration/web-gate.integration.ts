import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { $ } from 'bun';
import {
  container,
  containers,
  startContainer,
  master,
  killMaster,
  replacementMaster,
  exited,
  seen,
  load,
  loadMany,
} from './web-gate.test-support';

setupRitewayBun();
requireTestServices(process.env);

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

test('query and navigation hints never prime the Watch cache', async () => {
  const query = '/watch/zero-query?0';
  const navigation = '/watch/zero-prefetch';
  await load(query, {}, '203.0.113.21');
  await load(query, {}, '203.0.113.21');
  await load(
    navigation,
    { headers: { 'next-router-prefetch': '0' } },
    '203.0.113.22',
  );
  const document = await load(navigation, {}, '203.0.113.22');
  assert({
    given: 'a nonempty query or navigation hint whose value is zero',
    should: 'bypass storage and let the next document reach web',
    actual: [
      await seen(query),
      document.headers.get('x-gate-cache'),
      await seen(navigation),
    ],
    expected: [2, 'MISS', 2],
  });
});

test('middleware prefetch cannot poison an ordinary Watch document', async () => {
  const path = '/watch/middleware-prefetch';
  const variant = await load(
    path,
    { headers: { 'x-middleware-prefetch': '1' } },
    '203.0.113.24',
  );
  const document = await load(path, {}, '203.0.113.24');
  assert({
    given: 'a middleware prefetch before the first ordinary document',
    should: 'keep the non-document response out of the document cache',
    actual: [
      await variant.text(),
      (await document.text()).startsWith('page '),
      document.headers.get('x-gate-cache'),
    ],
    expected: ['{}', true, 'MISS'],
  });
});

test('an expired Watch page cannot outlive the five-second access bound', async () => {
  const path = '/watch/slow-refresh';
  await load(path, {}, '203.0.113.23');
  await Bun.sleep(6100);
  const refreshing = load(path, {}, '203.0.113.23');
  for (let attempt = 0; attempt < 30 && (await seen(path)) !== 2; attempt++)
    await Bun.sleep(20);
  const concurrent = await load(path, {}, '203.0.113.23');
  const body = await concurrent.text();
  await refreshing;
  assert({
    given: 'an expired Watch copy while its replacement is being read',
    should: 'wait for the replacement instead of serving expired access',
    actual: [
      ['STALE', 'UPDATING'].includes(
        concurrent.headers.get('x-gate-cache') ?? '',
      ),
      !body.endsWith(' 1'),
    ],
    expected: [false, true],
  });
}, 20_000);

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
  const webPid = (await load('/api/health/live')).headers.get('x-web-process');
  const previous = await master();
  await killMaster(container, previous);
  const replacement = await replacementMaster(container, previous);
  // A failed bind retries for 2.5 seconds; orphan workers can still answer meanwhile.
  await Bun.sleep(3000);
  const alive =
    replacement !== '' &&
    (
      await $`docker exec ${container} bash -c 'kill -0 "$1"' bash ${replacement}`
        .quiet()
        .nothrow()
    ).exitCode === 0;
  const back = (await load('/api/health/live').catch(() => null))?.status ?? 0;
  const logs = await $`docker logs ${container}`.text();
  assert({
    given: 'a killed nginx master whose workers held the listening sockets',
    should:
      'replace the master with a surviving process and keep web answering',
    actual: [
      replacement !== previous && replacement !== '',
      alive,
      back,
      (await load('/api/health/live')).headers.get('x-web-process') === webPid,
      logs.includes('Address already in use'),
    ],
    expected: [true, true, 200, true, false],
  });
}, 20_000);

test('stopping the machine lets web drain before the gate exits', async () => {
  const name = containers[1]!;
  await startContainer(name);
  await $`docker kill --signal=TERM ${name}`.quiet();
  const status = await exited(name);
  const logs = await $`docker logs ${name}`.text();
  assert({
    given: 'a machine shutdown signal',
    should: 'finish web draining and exit successfully',
    actual: [status, logs.includes('stand-in drained')],
    expected: ['0', true],
  });
}, 20_000);

test('repeated gate deaths drain web and fail the machine once', async () => {
  const name = containers[2]!;
  await startContainer(name);
  let pid = await master(name);
  for (let death = 1; death <= 5; death++) {
    await killMaster(name, pid);
    if (death < 5) pid = await replacementMaster(name, pid);
  }
  const status = await exited(name);
  const logs = await $`docker logs ${name}`.text();
  assert({
    given: 'five gate master deaths within a minute',
    should: 'recover four times, drain web once and exit unsuccessfully',
    actual: [
      status,
      logs.split('web_gate.restarted').length - 1,
      logs.split('web_gate.gave_up').length - 1,
      logs.split('stand-in drained').length - 1,
      logs.includes('Address already in use'),
    ],
    expected: ['1', 4, 1, 1, false],
  });
}, 30_000);
