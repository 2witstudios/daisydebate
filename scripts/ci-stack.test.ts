import { assert, setupRitewayBun, test } from 'riteway/bun';

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
      'use the compose memory-only Redis, dev-key LiveKit and pinned clamd instead of service copies, waiting for health',
    actual: {
      integrationServices: Object.keys(integration.services ?? {}).sort(),
      integrationStarts: runs(integration).includes(
        'docker compose -f infra/compose.yaml up -d --wait redis livekit clamd',
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
      'run the pinned scanner image with a healthcheck on loopback 3310, which both jobs name',
    actual: {
      image: compose.services.clamd?.image,
      ports: compose.services.clamd?.ports,
      healthcheck: compose.services.clamd?.healthcheck !== undefined,
      integrationPort: ci.jobs.integration!.env?.CLAMD_TEST_PORT,
      launchPort: e2e.jobs['room-launch']!.env?.CLAMD_TEST_PORT,
    },
    expected: {
      image: 'clamav/clamav:1.4.6',
      ports: ['127.0.0.1:3310:3310'],
      healthcheck: true,
      integrationPort: '3310',
      launchPort: '3310',
    },
  });
});
