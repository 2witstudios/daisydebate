import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

describe('dispatched quick-check trust boundary', () => {
  test('publishes the resolved checked SHA without executing candidate code with write permission', async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/quick-check.yml').text(),
    ) as {
      jobs: Record<
        string,
        {
          permissions?: Record<string, string>;
          needs?: string | string[];
          steps: {
            uses?: string;
            with?: Record<string, string>;
            env?: Record<string, string>;
            run?: string;
          }[];
        }
      >;
    };
    const resolve = workflow.jobs.resolve;
    const candidate = workflow.jobs['quick-check'];
    const publish = workflow.jobs['publish-dispatch'];
    assert({
      given: 'candidate execution',
      should: 'checkout the resolved SHA with only read access',
      actual: {
        permissions: candidate.permissions,
        ref: candidate.steps[0].with?.ref,
      },
      expected: {
        permissions: { contents: 'read' },
        ref: '${{ needs.resolve.outputs.sha || github.sha }}',
      },
    });
    assert({
      given: 'the write-capable publisher',
      should:
        'depend on checked results and never checkout or run repository scripts',
      actual: {
        needs: publish.needs,
        uses: publish.steps.flatMap(({ uses }) => (uses ? [uses] : [])),
        source: publish.steps[0].env?.CHECKED_SHA,
        executesCode: /\bbun\b|checkout|npm/.test(publish.steps[0].run ?? ''),
      },
      expected: {
        needs: ['resolve', 'quick-check'],
        uses: [],
        source: '${{ needs.resolve.outputs.sha }}',
        executesCode: false,
      },
    });
    assert({
      given: 'ref resolution',
      should: 'use only API reads without checkout',
      actual: resolve.steps.every(
        ({ uses, run }) => uses === undefined && run?.includes('gh api'),
      ),
      expected: true,
    });
  });
});
