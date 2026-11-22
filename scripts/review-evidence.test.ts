import { runInNewContext } from 'node:vm';
import { expect, test } from 'bun:test';
import { reviewEvidenceComment } from './review-evidence';

const head = '1'.repeat(40);
const input = {
  prHead: head,
  reviewSpec: 'e2e/prep-sidebar.e2e.ts',
  run: {
    head_sha: head,
    path: '.github/workflows/e2e.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    run_attempt: 1,
    conclusion: 'success',
  },
  repositoryUrl: 'https://github.com/example/daisy',
  runId: '123',
  artifacts: [
    {
      artifacts: [
        {
          id: 456,
          name: 'browser-review-evidence-attempt-1-success',
          expired: false,
        },
      ],
    },
  ],
};

test('links the retained media bundle and the run at the PR head', () => {
  const comment = reviewEvidenceComment(input);
  expect(comment).toContain(
    'https://github.com/example/daisy/actions/runs/123/artifacts/456',
  );
  expect(comment).toContain(head);
  expect(comment).toContain('attempts/1) · browser success · workflow success');
});

test('refuses the earlier artifact when a retry finishes without uploading', () => {
  expect(() =>
    reviewEvidenceComment({
      ...input,
      run: { ...input.run, run_attempt: 2, conclusion: 'failure' },
    }),
  ).toThrow('attempt 2');
});

test('links the producing retry and its browser outcome alongside earlier bundles', () => {
  const comment = reviewEvidenceComment({
    ...input,
    run: { ...input.run, run_attempt: 2, conclusion: 'success' },
    artifacts: [
      ...input.artifacts,
      {
        artifacts: [
          {
            id: 789,
            name: 'browser-review-evidence-attempt-2-failure',
            expired: false,
          },
        ],
      },
    ],
  });
  expect(comment).toContain('artifacts/789');
  expect(comment).toContain('attempts/2) · browser failure · workflow success');
  expect(comment).not.toContain('artifacts/456');
});

test('the workflow names bundles with the producing attempt and browser outcome', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file('.github/workflows/e2e.yml').text(),
  ) as {
    jobs: { e2e: { steps: { name?: string; with?: { name?: string } }[] } };
  };
  const upload = workflow.jobs.e2e.steps.find(
    ({ name }) => name === 'Upload browser review evidence',
  );
  expect(upload?.with?.name).toBe(
    'browser-review-evidence-attempt-${{ github.run_attempt }}-${{ steps.review_evidence.outcome }}',
  );
});

test('refuses stale run evidence and an expired or missing bundle', () => {
  expect(() =>
    reviewEvidenceComment({ ...input, prHead: '2'.repeat(40) }),
  ).toThrow('current PR head');
  expect(() =>
    reviewEvidenceComment({
      ...input,
      artifacts: [
        { artifacts: [{ ...input.artifacts[0]?.artifacts[0], expired: true }] },
      ],
    }),
  ).toThrow('unexpired');
  expect(() => reviewEvidenceComment({ ...input, artifacts: [] })).toThrow(
    'unexpired',
  );
});

test('names the captured client spec and refuses a malformed bundle identity', () => {
  expect(reviewEvidenceComment(input)).toContain('`e2e/prep-sidebar.e2e.ts`');
  expect(() =>
    reviewEvidenceComment({ ...input, reviewSpec: '../other.ts' }),
  ).toThrow('Invalid string');
});

test('targeted review capture skips unrelated admin and native workloads', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file('.github/workflows/e2e.yml').text(),
  ) as {
    jobs: Record<string, { if?: string }>;
  };
  expect(workflow.jobs.admin?.if).toBe('${{ !inputs.review_spec }}');
  expect(workflow.jobs['room-launch']?.if).toBe('${{ !inputs.review_spec }}');
  expect(workflow.jobs['native-gate']?.if).toBe(
    '${{ always() && !inputs.review_spec }}',
  );
});

test('targeted capture eligibility preserves full native qualification', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file('.github/workflows/e2e.yml').text(),
  ) as {
    jobs: Record<string, { if: string }>;
  };
  const eligible = (job: string, review_spec: string) =>
    runInNewContext(
      workflow.jobs[job]!.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ''),
      { inputs: { review_spec }, always: () => true },
      { timeout: 500 },
    );
  for (const job of ['admin', 'room-launch', 'native-gate']) {
    expect(eligible(job, '')).toBe(true);
    expect(eligible(job, 'e2e/prep-sidebar.e2e.ts')).toBe(false);
  }
});

test('review capture cannot publish the full native qualification check name', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file('.github/workflows/e2e.yml').text(),
  ) as {
    jobs: Record<string, { name: string }>;
  };
  const name = workflow.jobs['native-gate']!.name;
  const names = ['', 'e2e/prep-sidebar.e2e.ts'].map((review_spec) =>
    name.startsWith('${{')
      ? runInNewContext(
          name.replace(/^\$\{\{\s*|\s*\}\}$/g, ''),
          { inputs: { review_spec } },
          { timeout: 500 },
        )
      : name,
  );
  expect(names).toEqual([
    'Isolated Room Launch E2E',
    'Native suites omitted from browser review',
  ]);
});
