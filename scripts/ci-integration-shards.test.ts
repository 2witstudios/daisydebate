import { assert, setupRitewayBun, test } from 'riteway/bun';
import turbo from '../turbo.json';

setupRitewayBun();

test('CI runs every integration shard with independent services and requires all results', async () => {
  const { jobs } = Bun.YAML.parse(
    await Bun.file('.github/workflows/ci.yml').text(),
  ) as {
    jobs: Record<
      string,
      {
        strategy?: { 'fail-fast': boolean; matrix: { shard: number[] } };
        env?: Record<string, string>;
        services?: Record<string, unknown>;
        needs?: string[];
      }
    >;
  };
  assert({
    given: 'the real integration matrix, task environment and final gate',
    should:
      'execute all four workers on fresh services and never accept a partial matrix',
    actual: {
      matrix: jobs.integration.strategy?.matrix,
      failFast: jobs.integration.strategy?.['fail-fast'],
      selector: jobs.integration.env?.DAISY_INTEGRATION_SHARD,
      services: Object.keys(jobs.integration.services ?? {}),
      forwarded: (
        turbo.tasks['test:integration'].passThroughEnv as string[]
      ).includes('DAISY_INTEGRATION_SHARD'),
      required: jobs.gate.needs?.includes('integration'),
      coverageRequired: jobs.gate.needs?.includes('integration-coverage'),
    },
    expected: {
      matrix: { shard: [1, 2, 3, 4] },
      failFast: false,
      selector: '${{ matrix.shard }}/4',
      services: ['postgres'],
      forwarded: true,
      required: true,
      coverageRequired: true,
    },
  });
});
