import { runInNewContext } from 'node:vm';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

const context = (eventName: string, runId: number, workflow: string) => ({
  workflow,
  event_name: eventName,
  event: { pull_request: { number: eventName === 'pull_request' ? 42 : 0 } },
  run_id: runId,
  ref: 'refs/heads/main',
});

// These workflow expressions use the common JS/GitHub subset: paths, || and ==.
const evaluate = (
  source: string | boolean,
  github: ReturnType<typeof context>,
) =>
  typeof source === 'boolean'
    ? String(source)
    : source.replace(/\$\{\{(.*?)\}\}/g, (_, expression: string) =>
        String(runInNewContext(expression, { github }, { timeout: 100 })),
      );

describe('CI workflow concurrency', () => {
  test('ci preserves every accepted candidate while superseding PR runs', async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/ci.yml').text(),
    ) as {
      name: string;
      concurrency: { group: string; 'cancel-in-progress': string | boolean };
    };
    const { group, 'cancel-in-progress': cancel } = workflow.concurrency;
    const outcomes = ['push', 'workflow_dispatch', 'pull_request'].map(
      (event) => {
        const first = context(event, 101, workflow.name);
        const next = context(event, 102, workflow.name);
        return {
          event,
          sharesGroup: evaluate(group, first) === evaluate(group, next),
          cancels: evaluate(cancel, next),
        };
      },
    );
    assert({
      given: 'two main, manual and same-PR runs',
      should: 'isolate accepted candidates and only cancel superseded PR work',
      actual: outcomes,
      expected: [
        { event: 'push', sharesGroup: false, cancels: 'false' },
        { event: 'workflow_dispatch', sharesGroup: false, cancels: 'false' },
        { event: 'pull_request', sharesGroup: true, cancels: 'true' },
      ],
    });
    const otherPr = {
      ...context('pull_request', 103, workflow.name),
      event: { pull_request: { number: 43 } },
    };
    assert({
      given: 'another PR running in the same workflow',
      should: 'preserve its independent concurrency group',
      actual:
        evaluate(group, context('pull_request', 101, workflow.name)) ===
        evaluate(group, otherPr),
      expected: false,
    });
  });

  test("e2e cancels only a PR's superseded run", async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file('.github/workflows/e2e.yml').text(),
    ) as { concurrency?: { group?: string; 'cancel-in-progress'?: string } };
    const group = workflow.concurrency?.group ?? '';
    assert({
      given: 'the browser workflow',
      should:
        "group a PR's runs by its number and every other run by itself, cancelling in progress on a PR alone",
      actual: {
        prGroup: group.includes(
          "github.event_name == 'pull_request' && format('browser-pr-{0}', github.event.pull_request.number)",
        ),
        otherwiseOwnRun: group.includes(
          "|| format('browser-run-{0}', github.run_id)",
        ),
        cancels: workflow.concurrency?.['cancel-in-progress'],
      },
      expected: {
        prGroup: true,
        otherwiseOwnRun: true,
        cancels: "${{ github.event_name == 'pull_request' }}",
      },
    });
  });
});
