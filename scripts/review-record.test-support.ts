// Shared fixtures for the review-record tests: a PR and a record builder
// with sensible defaults, overridable per test.
import type { PullRequest, RecordPage } from './review-record';

export const sha = 'a'.repeat(40);
export const pr: PullRequest = {
  number: 57,
  headSha: sha,
  body: 'Builder: ag-builder\n',
};

export const record = (
  overrides: Partial<{
    title: string;
    candidate: string;
    verdict: string;
    gates: string;
    findings: string;
  }> = {},
): RecordPage => ({
  id: 'rec1111111111111111111111',
  title: overrides.title ?? `Review record — GRD-6.1 (${sha})`,
  content: [
    '# Review: GRD-6.1 (pu/grd-6-autonomy)',
    overrides.candidate ??
      `Candidate: ${sha} · PR #57 · Builder: ag-builder · Reviewer: ag-reviewer`,
    '## Gates run',
    overrides.gates ??
      [
        'bun check at aaaaaaa: PASS',
        'bun test:integration: PASS (165 pass, 0 fail)',
        'Negative control run: yes (below)',
      ].join('\n'),
    '## Findings',
    overrides.findings ?? '- [ ] minor · scripts/x.ts:1 · y · GRD-6.7',
    '## Verdict',
    overrides.verdict ??
      '0 blocker / 0 major / 1 minor / 0 nit — APPROVE WITH MINORS',
  ].join('\n'),
});
