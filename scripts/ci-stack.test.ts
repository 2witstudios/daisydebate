import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clamdTestPort,
  clickHouseTest,
  slotEnvValues,
  worktreeSlot,
} from './slot-model';

setupRitewayBun();

type Job = {
  services?: Record<string, unknown>;
  steps: { run?: string }[];
};
type Workflow = { jobs: Record<string, Job> };
type Compose = {
  services: Record<
    string,
    {
      command?: string[];
      environment?: Record<string, string>;
      healthcheck?: unknown;
      image?: string;
      ports?: string[];
    }
  >;
};

const read = async <T>(path: string) =>
  Bun.YAML.parse(
    await Bun.file(new URL(`../${path}`, import.meta.url)).text(),
  ) as T;

const runs = (job: Job) => job.steps.map((step) => step.run ?? '');

test('CI starts Redis and LiveKit from the one local compose stack', async () => {
  const ci = await read<Workflow>('.github/workflows/ci.yml');
  const e2e = await read<Workflow>('.github/workflows/e2e.yml');
  const compose = await read<Compose>('infra/compose.yaml');
  const integration = ci.jobs.integration!;
  const launch = e2e.jobs['room-launch']!;
  assert({
    given: 'the infrastructure and isolated Room Launch jobs',
    should:
      'use the compose memory-only Redis, dev-key LiveKit, pinned clamd and the log store instead of service copies, waiting for health',
    actual: {
      integrationServices: Object.keys(integration.services ?? {}).sort(),
      integrationStarts: runs(integration).includes(
        'docker compose -f infra/compose.yaml up -d --wait redis livekit clamd clickhouse',
      ),
      launchServices: Object.keys(launch.services ?? {}).sort(),
      launchStartsStack: runs(launch).includes('bun slot:up'),
      redis: compose.services.redis?.command?.slice(1, 5),
      livekitHealthcheck: compose.services.livekit?.healthcheck !== undefined,
    },
    expected: {
      integrationServices: ['postgres'],
      integrationStarts: true,
      launchServices: [],
      launchStartsStack: true,
      redis: ['--appendonly', 'no', '--save', ''],
      livekitHealthcheck: true,
    },
  });
});

test('clamd is one pinned compose service on the port every job and slot names', async () => {
  const port = String(clamdTestPort);
  const ci = await read<{
    jobs: Record<string, Job & { env?: Record<string, string> }>;
  }>('.github/workflows/ci.yml');
  const e2e = await read<{
    jobs: Record<string, Job & { env?: Record<string, string> }>;
  }>('.github/workflows/e2e.yml');
  const compose = await read<Compose>('infra/compose.yaml');
  assert({
    given: 'the compose stack and the jobs that run the messaging file suites',
    should:
      'run the pinned scanner image with a healthcheck on the named loopback port, which both jobs and every slot name',
    actual: {
      image: compose.services.clamd?.image,
      ports: compose.services.clamd?.ports,
      healthcheck: compose.services.clamd?.healthcheck !== undefined,
      integrationPort: ci.jobs.integration!.env?.CLAMD_TEST_PORT,
      launchPort: e2e.jobs['room-launch']!.env?.CLAMD_TEST_PORT,
      slotPort: slotEnvValues({
        slot: worktreeSlot('abc'),
        env: { DATABASE_URL: 'postgres://h/d', REDIS_URL: 'redis://h' },
        portBlock: 1,
      }).CLAMD_TEST_PORT,
    },
    expected: {
      image: 'clamav/clamav:1.4.6',
      ports: [`127.0.0.1:${port}:${port}`],
      healthcheck: true,
      integrationPort: port,
      launchPort: port,
      slotPort: port,
    },
  });
});

test('the log store is one compose service whose port and passwords every job and slot name', async () => {
  const ci = await read<{
    jobs: Record<string, Job & { env?: Record<string, string> }>;
  }>('.github/workflows/ci.yml');
  const compose = await read<Compose>('infra/compose.yaml');
  const service = compose.services.clickhouse;
  const env = ci.jobs.integration!.env ?? {};
  const slot = slotEnvValues({
    slot: worktreeSlot('abc'),
    env: { DATABASE_URL: 'postgres://h/d', REDIS_URL: 'redis://h' },
    portBlock: 1,
  });
  const named = (source: Record<string, string | undefined>) => ({
    url: source.TEST_CLICKHOUSE_URL,
    shipperPassword: source.TEST_CLICKHOUSE_SHIPPER_PASSWORD,
    readerPassword: source.TEST_CLICKHOUSE_READER_PASSWORD,
  });
  assert({
    given: 'the compose log store, the integration job and a slot',
    should:
      'publish one loopback port with healthcheck and the same dev-only passwords everywhere',
    actual: {
      ports: service?.ports,
      healthcheck: service?.healthcheck !== undefined,
      compose: {
        url: `http://${service?.ports?.[0]?.split(':').slice(0, 2).join(':')}`,
        shipperPassword: service?.environment?.CLICKHOUSE_SHIPPER_PASSWORD,
        readerPassword: service?.environment?.CLICKHOUSE_READER_PASSWORD,
      },
      ci: named(env),
      slot: named(slot),
    },
    expected: {
      ports: ['127.0.0.1:18123:8123'],
      healthcheck: true,
      compose: clickHouseTest,
      ci: clickHouseTest,
      slot: clickHouseTest,
    },
  });
});
