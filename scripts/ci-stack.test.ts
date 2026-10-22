import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

type Job = {
  services?: Record<string, unknown>;
  steps: { run?: string }[];
};
type Workflow = { jobs: Record<string, Job> };
type Compose = {
  services: Record<string, { command?: string[]; healthcheck?: unknown }>;
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
      'use the compose memory-only Redis and dev-key LiveKit instead of service copies, waiting for health',
    actual: {
      integrationServices: Object.keys(integration.services ?? {}).sort(),
      integrationStarts: runs(integration).includes(
        'docker compose -f infra/compose.yaml up -d --wait redis livekit',
      ),
      launchServices: Object.keys(launch.services ?? {}).sort(),
      launchStartsStack: runs(launch).includes('bun slot:up'),
      redis: compose.services.redis?.command?.slice(1, 5),
      livekitHealthcheck: compose.services.livekit?.healthcheck !== undefined,
    },
    expected: {
      integrationServices: ['clamd', 'postgres'],
      integrationStarts: true,
      launchServices: ['clamd'],
      launchStartsStack: true,
      redis: ['--appendonly', 'no', '--save', ''],
      livekitHealthcheck: true,
    },
  });
});
