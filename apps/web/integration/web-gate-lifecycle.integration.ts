import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { $ } from 'bun';
import {
  gateAdmissions,
  container,
  containers,
  startContainer,
  master,
  killMaster,
  replacementMaster,
  exited,
  load,
} from './web-gate.test-support';

setupRitewayBun();
requireTestServices(process.env);

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
    given: 'the real gate supervisor restart event',
    should: 'be admitted by the centralized log boundary',
    actual: [
      gateAdmissions(logs),
      logs.includes('"appVersion":"development"'),
      logs.includes('"gitCommit":"unknown"'),
    ],
    expected: [[true], true, true],
  });
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
    given: 'restart and repeated-death events from the real supervisor',
    should: 'be admitted with valid severity and deployment metadata',
    actual: gateAdmissions(logs),
    expected: [true, true, true, true, true],
  });
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

test('an unresolved gateway fails closed with an admitted deployment event', async () => {
  const name = containers[3]!;
  await $`docker run -d --name ${name} --network none --user 1001:1001 -e PORT=8090 -e APP_VERSION=gate-proof -e GIT_COMMIT=fixture-commit -w /app/apps/web daisy-web-gate-proof bash gate/start.sh`.quiet();
  const status = await exited(name);
  const logs = await $`docker logs ${name}`.text();
  assert({
    given: 'no default gateway and supplied deployment identity',
    should: 'refuse startup and retain the failure under that identity',
    actual: [
      status,
      gateAdmissions(logs),
      logs.includes('web_gate.gateway_unresolved'),
      logs.includes('"appVersion":"gate-proof"'),
      logs.includes('"gitCommit":"fixture-commit"'),
    ],
    expected: ['1', [true], true, true, true],
  });
});

test('malformed deployment metadata is never interpolated into a log', async () => {
  for (const [label, invalid] of [
    ['empty', ''],
    ['json', 'invalid"deployment'],
  ] as const) {
    const name = `${containers[4]}-${label}`;
    containers.push(name);
    await $`docker run -d --name ${name} --network none --user 1001:1001 -e PORT=8090 -e APP_VERSION=${invalid} -w /app/apps/web daisy-web-gate-proof bash gate/start.sh`.quiet();
    const status = await exited(name);
    const logs = await $`docker logs ${name}`.text();
    assert({
      given: `${label} deployment metadata outside the log-ingestion base contract`,
      should: 'fail startup without printing the rejected raw value',
      actual: [
        status,
        logs.includes('Invalid gate deployment metadata'),
        invalid === '' || !logs.includes(invalid),
      ],
      expected: ['1', true, true],
    });
  }
});
