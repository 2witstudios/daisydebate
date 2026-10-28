import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import { mergeChangedFiles } from './docs-merge-files';

setupRitewayBun();

// A repository where main moves on after the branch was cut, so the PR's
// recorded base.sha is older than the merge's first parent.
const repositoryWithStaleBase = () => {
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
  commit('base.md', 'base');
  const baseSha = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'slice');
  commit('slice.md', 'slice');
  git('checkout', '-q', 'main');
  commit('other.md', 'merged meanwhile');
  git('merge', '-q', '--no-ff', '-m', 'merge slice', 'slice');
  return {
    cwd,
    baseSha,
    mergeSha: git('rev-parse', 'HEAD'),
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
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

  test('refuses anything but a commit sha', async () => {
    let message = '';
    try {
      mergeChangedFiles('--output=/tmp/x');
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'an option-shaped argument',
      should: 'throw before running git',
      actual: message,
      expected: 'A merge commit must be a 40-character hex sha',
    });
  });
});

describe('documentation workflows', async () => {
  const root = resolve(import.meta.dir, '..');
  const workflow = (name: string) =>
    readFileSync(join(root, '.github/workflows', name), 'utf8');

  test('take changed files from the one merge-files script', async () => {
    const workflows = ['notify-merge.yml', 'docs-replay.yml'].map(workflow);
    assert({
      given: 'the merge notification and the replay workflows',
      should: 'list changed files with docs-merge-files, never git diff',
      actual: workflows.map((text) => ({
        script: text.includes('bun scripts/docs-merge-files.ts'),
        diff: text.includes('git diff'),
      })),
      expected: workflows.map(() => ({ script: true, diff: false })),
    });
  });
});
