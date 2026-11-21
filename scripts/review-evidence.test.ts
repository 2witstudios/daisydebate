import { expect, test } from 'bun:test';
import { reviewEvidenceComment } from './review-evidence';

const head = '1'.repeat(40);
const input = {
  prHead: head,
  run: {
    head_sha: head,
    path: '.github/workflows/e2e.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
  },
  repositoryUrl: 'https://github.com/example/daisy',
  runId: '123',
  artifacts: [
    {
      artifacts: [{ id: 456, name: 'browser-review-evidence', expired: false }],
    },
  ],
};

test('links the retained media bundle and the run at the PR head', () => {
  const comment = reviewEvidenceComment(input);
  expect(comment).toContain(
    'https://github.com/example/daisy/actions/runs/123/artifacts/456',
  );
  expect(comment).toContain(head);
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
