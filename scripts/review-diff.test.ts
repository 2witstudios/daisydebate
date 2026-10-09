import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { documentationOnly, type ReviewDiff } from './review-diff';
import { pr, record, sha } from './review-record.test-support';
import { verifyReviewRecord } from './review-record';

setupRitewayBun();

const diff = (
  path: string,
  overrides: Partial<ReviewDiff['files'][number]> = {},
): ReviewDiff => ({
  headSha: sha,
  complete: true,
  files: [
    {
      path,
      status: 'modified',
      oldMode: '100644',
      newMode: '100644',
      ...overrides,
    },
  ],
});

describe('documentation evidence applicability', () => {
  test('recognizes decorated branch metadata without interpreting findings as metadata', () => {
    const states = [
      'Review stage: branch',
      '## Review stage: branch',
      '# Review stage: branch',
      '- **Review stage: branch**',
    ].map(
      (label) =>
        verifyReviewRecord(pr, [
          { ...record(), content: `${label}\n${record().content}` },
        ]).state,
    );
    assert({
      given:
        'branch metadata in common Markdown forms with an otherwise approving record',
      should: 'never mint acceptance',
      actual: states,
      expected: ['pending', 'pending', 'pending', 'pending'],
    });
    assert({
      given: 'a quoted stage label in findings',
      should: 'still judge the acceptance evidence',
      actual: verifyReviewRecord(pr, [
        record({
          findings: '## Review stage: branch',
          gates: 'bun check: PASS',
        }),
      ]).state,
      expected: 'failure',
    });
  });

  test('classifies actual paths and modes, never an extension or reviewer label alone', () => {
    const cases = [
      diff('docs/decisions/0060-policy.md'),
      diff('docs/development/guide.md', {
        status: 'added',
        oldMode: undefined,
      }),
      diff('docs/operations/old.md', { status: 'removed', newMode: undefined }),
      diff('docs/architecture/new.md', {
        status: 'renamed',
        previousPath: 'docs/architecture/old.md',
      }),
      diff('AGENTS.md'),
      diff('.claude/skills/task/SKILL.md'),
      diff('docs/skills/SKILL.md'),
      diff('docs/AGENTS.md'),
      diff('scripts/guide.md'),
      diff('docs/build.ts'),
      diff('docs/guide.md', { newMode: '100755' }),
      diff('docs/guide.md', { newMode: '120000' }),
      diff('docs/guide.md', { oldMode: '100755' }),
      diff('docs/new.md', {
        status: 'renamed',
        previousPath: 'scripts/run.ts',
      }),
      diff('docs/new.md', { status: 'unknown' }),
      diff('docs/new.md', { newMode: undefined }),
      { ...diff('docs/new.md'), complete: false },
      { ...diff('docs/new.md'), headSha: 'b'.repeat(40) },
      { ...diff('docs/new.md'), files: [] },
      undefined,
    ];
    assert({
      given:
        'regular document edits and executable, instruction, renamed, missing and incomplete diffs',
      should: 'permit only a complete document diff for the exact candidate',
      actual: cases.map((candidate) => documentationOnly(candidate, sha)),
      expected: cases.map((_, index) => index < 4),
    });
  });

  test('allows applicable nonservice proof only on a verified document candidate', () => {
    const reviewed = record({
      verdict: '0 blocker / 0 major / 0 minor / 0 nit — APPROVE',
      gates: `bun check at ${sha}: PASS\nDocumentation review: PASS (contracts, links, status and numbers)\nNegative control run: yes (number collision refused)\nbun test:integration: NOT RUN (documentation-only)`,
    });
    const mixed = {
      ...diff('docs/guide.md'),
      files: [
        ...diff('docs/guide.md').files,
        ...diff('packages/db/schema.sql').files,
      ],
    };
    assert({
      given:
        'the same document evidence on a doc-only, mixed, missing and stale diff',
      should: 'approve only the verified document diff',
      actual: [
        diff('docs/guide.md'),
        mixed,
        undefined,
        { ...diff('docs/guide.md'), headSha: 'b'.repeat(40) },
      ].map(
        (candidate) =>
          verifyReviewRecord({ ...pr, diff: candidate }, [reviewed]).state,
      ),
      expected: ['success', 'failure', 'failure', 'failure'],
    });
    assert({
      given:
        'eligible docs with no independent contract proof, or a false PASS',
      should: 'refuse both approvals',
      actual: [
        'bun check: PASS\nNegative control run: yes',
        'bun check: PASS\nDocumentation review: PASS (not run)\nNegative control run: yes',
      ].map(
        (gates) =>
          verifyReviewRecord({ ...pr, diff: diff('docs/guide.md') }, [
            record({ gates }),
          ]).state,
      ),
      expected: ['failure', 'failure'],
    });
  });

  test('requires runtime proof even when an approval includes a minor finding', () => {
    assert({
      given: 'a runtime approval with a minor but deferred integration',
      should: 'refuse the missing evidence regardless of finding count',
      actual: verifyReviewRecord(pr, [record({ gates: 'bun check: PASS' })])
        .state,
      expected: 'failure',
    });
  });

  test('keeps branch feedback separate from acceptance and never mints main success from it', () => {
    const feedback = {
      ...record(),
      content: `Review stage: branch\n${record().content}`,
    };
    assert({
      given:
        'branch feedback alone and branch feedback alongside independent acceptance',
      should: 'require an acceptance record for main',
      actual: [
        verifyReviewRecord(pr, [feedback]).state,
        verifyReviewRecord(pr, [feedback, record()]).state,
        verifyReviewRecord(pr, [
          record({
            findings: 'Review stage: branch',
            gates: 'bun check: PASS',
          }),
        ]).state,
      ],
      expected: ['pending', 'success', 'failure'],
    });
  });
});
