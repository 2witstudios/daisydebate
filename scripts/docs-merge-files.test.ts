import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from 'bun:test';
import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import { mergeChangedFiles } from './docs-merge-files';

setupRitewayBun();

const initRepository = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'docs-merge-files-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const commit = (file: string, message: string) => {
    writeFileSync(join(cwd, file), message);
    git('add', file);
    git('commit', '-q', '-m', message);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'test');
  return {
    cwd,
    git,
    commit,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
};

// A repository where main moves on after the branch was cut, so the PR's
// recorded base.sha is older than the merge's first parent.
const repositoryWithStaleBase = () => {
  const repo = initRepository();
  const { git, commit } = repo;
  commit('base.md', 'base');
  const baseSha = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'slice');
  commit('slice.md', 'slice');
  git('checkout', '-q', 'main');
  commit('other.md', 'merged meanwhile');
  git('merge', '-q', '--no-ff', '-m', 'merge slice', 'slice');
  return { ...repo, baseSha, mergeSha: git('rev-parse', 'HEAD') };
};

// A merge whose only change is a rename of a path pages may cite (ISSUE-860).
const repositoryWithRename = () => {
  const repo = initRepository();
  const { git, commit } = repo;
  commit('old.md', 'cited content');
  git('checkout', '-q', '-b', 'slice');
  git('mv', 'old.md', 'new.md');
  git('commit', '-q', '-m', 'rename old.md to new.md');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'merge rename', 'slice');
  return { ...repo, mergeSha: git('rev-parse', 'HEAD') };
};

describe('mergeChangedFiles', async () => {
  test("lists the merge's own files, not main's advance since base.sha", async () => {
    const repo = repositoryWithStaleBase();
    try {
      assert({
        given: 'a merge whose base.sha predates another merge to main',
        should: 'diff from the merge commit first parent only',
        actual: {
          own: mergeChangedFiles(repo.mergeSha, repo.cwd),
          staleBase: execFileSync(
            'git',
            ['diff', '--name-only', repo.baseSha, repo.mergeSha],
            { cwd: repo.cwd, encoding: 'utf8' },
          )
            .trim()
            .split('\n'),
        },
        expected: { own: ['slice.md'], staleBase: ['other.md', 'slice.md'] },
      });
    } finally {
      repo.cleanup();
    }
  });

  test('lists both sides of a renamed file', async () => {
    const repo = repositoryWithRename();
    try {
      assert({
        given: 'a merge that git mv renames a cited path',
        should: 'list the old and the new name (ISSUE-860)',
        actual: mergeChangedFiles(repo.mergeSha, repo.cwd),
        expected: ['new.md', 'old.md'],
      });
    } finally {
      repo.cleanup();
    }
  });

  test('dispatches a large merge without exporting its paths', async () => {
    const repo = repositoryWithStaleBase();
    try {
      // Exceed both the incident's 170 KB and execFileSync's default 1 MiB.
      const files = Array.from(
        { length: 4600 },
        (_, i) => `${String(i).padStart(5, '0')}-${'x'.repeat(230)}.test.ts`,
      );
      repo.git('checkout', '-q', '-b', 'large');
      files.forEach((file) => writeFileSync(join(repo.cwd, file), 'test'));
      repo.git('mv', 'slice.md', 'renamed.md');
      repo.git('add', '.');
      repo.git('commit', '-q', '-m', 'large change');
      repo.git('checkout', '-q', 'main');
      repo.commit('unrelated.md', 'main advance');
      repo.git('merge', '-q', '--no-ff', '-m', 'large merge', 'large');
      const sha = repo.git('rev-parse', 'HEAD');
      const expectedFiles = [...files, 'renamed.md', 'slice.md'].sort();
      expect(expectedFiles.join(',').length).toBeGreaterThan(1024 * 1024);
      const script = resolve(import.meta.dir, 'dispatch-docs.ts');
      const event = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '-e',
            `import { createDispatchEvent } from ${JSON.stringify(script)}; console.log(JSON.stringify(createDispatchEvent(process.cwd())));`,
          ],
          {
            cwd: repo.cwd,
            env: {
              PATH: process.env.PATH,
              DOC_EVENT_ID: `123-${sha}`,
              DOC_OCCURRED_AT: '2026-11-22T14:42:00Z',
              DOC_REPOSITORY: 'example/repo',
              DOC_BASE_REF: 'main',
              DOC_COMMIT: sha,
              DOC_PR_NUMBER: '819',
              DOC_TITLE: 'fix: large change',
              DOC_PR_URL: 'https://example.test/pull/819',
            },
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
          },
        ),
      );
      assert({
        given:
          'a real merge with over 1 MiB of paths, a rename and unrelated main changes',
        should:
          'build the complete event in a fresh Bun process with unchanged identity',
        actual: {
          files: event.changedFiles,
          refs: event.sourceRefs,
          eventId: event.eventId,
          key: event.idempotencyKey,
          commit: event.commit,
          type: event.eventType,
          occurredAt: event.occurredAt,
          pr: event.pullRequest.number,
        },
        expected: {
          files: expectedFiles,
          refs: expectedFiles,
          eventId: `123-${sha}`,
          key: `example/repo:${sha}:pull_request.merged`,
          commit: sha,
          type: 'pull_request.merged',
          occurredAt: '2026-11-22T14:42:00Z',
          pr: 819,
        },
      });
    } finally {
      repo.cleanup();
    }
  }, 30_000);

  test('retains the release changed-files input without reading Git', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'docs-release-event-'));
    try {
      const event = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '-e',
            `import { createDispatchEvent } from ${JSON.stringify(resolve(import.meta.dir, 'dispatch-docs.ts'))}; console.log(JSON.stringify(createDispatchEvent(process.cwd())));`,
          ],
          {
            cwd,
            env: {
              DOC_EVENT_TYPE: 'release.published',
              DOC_EVENT_ID: 'release-42',
              DOC_OCCURRED_AT: '2026-11-22T14:42:00Z',
              DOC_REPOSITORY: 'example/repo',
              DOC_BASE_REF: 'main',
              DOC_COMMIT: 'a'.repeat(40),
              DOC_PR_NUMBER: '0',
              DOC_TITLE: 'Release 42',
              DOC_PR_URL: 'https://example.test/releases/42',
              DOC_CHANGED_FILES: 'b.ts,a.ts,b.ts',
            },
            encoding: 'utf8',
          },
        ),
      );
      assert({
        given: 'a release event outside a Git repository',
        should: 'retain its explicit paths and original event identity',
        actual: [event.changedFiles, event.eventId, event.idempotencyKey],
        expected: [
          ['a.ts', 'b.ts'],
          'release-42',
          `example/repo:${'a'.repeat(40)}:release.published`,
        ],
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('refuses anything but a commit sha', async () => {
    expect(() => mergeChangedFiles('--output=/tmp/x')).toThrow(
      'A merge commit must be a 40-character hex sha',
    );
  });
});

describe('documentation workflows', async () => {
  const root = resolve(import.meta.dir, '..');
  const workflow = (name: string) =>
    readFileSync(join(root, '.github/workflows', name), 'utf8');

  test('dispatch merged events without exporting changed paths', async () => {
    const workflows = ['notify-merge.yml', 'docs-replay.yml'].map(workflow);
    assert({
      given: 'the merge notification and the replay workflows',
      should:
        'dispatch merged events directly without exporting paths or duplicating git diff',
      actual: workflows.map((text) => ({
        script:
          text.includes('run: bun scripts/dispatch-docs.ts') ||
          text.includes('          bun scripts/dispatch-docs.ts'),
        exportsPaths: text.includes('DOC_CHANGED_FILES'),
        diff: text.includes('git diff'),
      })),
      expected: workflows.map(() => ({
        script: true,
        exportsPaths: false,
        diff: false,
      })),
    });
  });

  test('the release event lists both sides of a renamed file', async () => {
    const text = workflow('notify-release.yml');
    assert({
      given: 'the release notification workflow',
      should:
        'diff with --no-renames so pages citing the old name are not skipped (ISSUE-860)',
      actual: text.includes('--name-only --no-renames'),
      expected: true,
    });
  });
});
