import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readPullRequestDiff } from './review-record-io';
import { documentationOnly } from './review-diff';

setupRitewayBun();

describe('live review diff reader', () => {
  test('binds the file list to the captured head even if the live PR changes', () => {
    const source = {
      head: { sha: 'a'.repeat(40) },
      base: { sha: 'b'.repeat(40) },
      changed_files: 1,
    };
    const calls: string[] = [];
    const candidate = readPullRequestDiff(
      (args) => {
        const path = args.at(-1) ?? '';
        calls.push(path);
        const response = path.includes('/compare/')
          ? {
              merge_base_commit: { sha: 'c'.repeat(40) },
              files: [{ filename: 'scripts/runtime.ts', status: 'modified' }],
            }
          : path.endsWith('/files')
            ? [[{ filename: 'docs/guide.md', status: 'modified' }]]
            : {
                truncated: false,
                tree: [
                  { path: 'docs/guide.md', mode: '100644' },
                  { path: 'scripts/runtime.ts', mode: '100644' },
                ],
              };
        return { code: 0, stdout: JSON.stringify(response) };
      },
      'owner/repo',
      source,
    );
    assert({
      given:
        'a runtime head captured before a docs-only force push with the same file count',
      should:
        'classify the captured runtime head using only SHA-bound evidence',
      actual: [
        documentationOnly(candidate, source.head.sha),
        calls.some((path) => path.endsWith('/files')),
      ],
      expected: [false, false],
    });
  });

  test('uses merge-base modes and refuses incomplete or unavailable API evidence', () => {
    const source = {
      head: { sha: 'a'.repeat(40) },
      base: { sha: 'b'.repeat(40) },
      changed_files: 1,
    };
    const cases = [
      {
        mode: '100644',
        truncated: false,
        files: 1,
        error: false,
        expected: true,
      },
      {
        mode: '100755',
        truncated: false,
        files: 1,
        error: false,
        expected: false,
      },
      {
        mode: '100644',
        truncated: true,
        files: 1,
        error: false,
        expected: false,
      },
      {
        mode: '100644',
        truncated: false,
        files: 0,
        error: false,
        expected: false,
      },
      {
        mode: '100644',
        truncated: false,
        files: 1,
        error: true,
        expected: false,
      },
    ];
    const results = cases.map((candidate) => {
      const calls: string[] = [];
      const diff = readPullRequestDiff(
        (args) => {
          const path = args.at(-1) ?? '';
          calls.push(path);
          const result = path.includes('/compare/')
            ? {
                merge_base_commit: { sha: 'c'.repeat(40) },
                files: Array.from({ length: candidate.files }, () => ({
                  filename: 'docs/guide.md',
                  status: 'modified',
                })),
              }
            : path.endsWith('/files')
              ? [
                  Array.from({ length: candidate.files }, () => ({
                    filename: 'docs/guide.md',
                    status: 'modified',
                  })),
                ]
              : {
                  truncated: candidate.truncated,
                  tree: [{ path: 'docs/guide.md', mode: candidate.mode }],
                };
          return {
            code: candidate.error ? 1 : 0,
            stdout: JSON.stringify(result),
          };
        },
        'owner/repo',
        source,
      );
      return {
        docs: documentationOnly(diff, source.head.sha),
        mergeBaseRead:
          candidate.error ||
          calls.some((path) => path.includes('c'.repeat(40))),
      };
    });
    assert({
      given:
        'a real-shaped PR API, mode changes, truncated trees, missing files and request failure',
      should:
        'verify document eligibility only with complete exact-candidate tree facts',
      actual: results,
      expected: cases.map(({ expected }) => ({
        docs: expected,
        mergeBaseRead: true,
      })),
    });
  });
});
