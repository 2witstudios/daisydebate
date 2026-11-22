import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { preparePendingPr } from './prepare-pr';
import { prDecisionProblems } from './pr-decision-numbers';
import { applyPendingPreparation } from './pending-preparation-writes';

setupRitewayBun();
const participant = 'packages/db/migrations';
const admin = 'apps/admin/src/db/migrations';
const origin = '00000000-0000-0000-0000-000000000000';

function repository(adminTag = '20261120000000_next') {
  const cwd = mkdtempSync(join(tmpdir(), 'prepare-pr-review-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  const write = (folder: string, tag: string, id: string, previous: string) => {
    mkdirSync(join(cwd, folder, tag), { recursive: true });
    writeFileSync(join(cwd, folder, tag, 'migration.sql'), `SELECT '${id}';\n`);
    writeFileSync(
      join(cwd, folder, tag, 'snapshot.json'),
      JSON.stringify({ id, prevIds: [previous] }),
    );
  };
  write(participant, '20261121000000_base', 'p-base', origin);
  write(admin, adminTag, 'a-base', origin);
  git('add', '.');
  git('commit', '-qm', 'landed');
  const base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', base);
  return {
    cwd,
    git,
    write,
    base,
    prepare: () =>
      preparePendingPr({ number: 868, baseRef: base, check: false }, cwd),
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

describe('numbering review regressions in disposable repositories', () => {
  for (const restorationFails of [false, true]) {
    test(`restores directory moves despite a partial write${restorationFails ? ' and reports a failed restoration' : ''}`, () => {
      const repo = repository();
      try {
        const from = `${participant}/20261120000000_next`,
          to = `${participant}/20261121000001_next`;
        repo.write(participant, '20261120000000_next', 'p-next', 'p-base');
        const before = "const migration='20261120000000_next';\n",
          after = "const migration='20261121000001_next';\n";
        const first = 'a-proof.ts',
          second = 'z-proof.ts';
        writeFileSync(join(repo.cwd, first), before);
        writeFileSync(join(repo.cwd, second), before);
        let failure: unknown;
        try {
          applyPendingPreparation(
            repo.cwd,
            [{ from, to }],
            [
              { path: first, before, after },
              { path: second, before, after },
            ],
            {
              read: (path) => readFileSync(path, 'utf8'),
              rename: (from, to) => renameSync(from, to),
              write: (path, text) => {
                if (path === join(repo.cwd, second) && text === after) {
                  writeFileSync(path, 'partial');
                  throw new Error('simulated interrupted filesystem write');
                }
                if (
                  restorationFails &&
                  path === join(repo.cwd, first) &&
                  text === before
                )
                  throw new Error('simulated unavailable restoration');
                writeFileSync(path, text);
              },
            },
          );
        } catch (error) {
          failure = error;
        }
        assert({
          given:
            'real directory/file mutations with an injected interrupted write at the filesystem edge',
          should:
            'restore every possible change independently and report any remaining path honestly',
          actual: [
            existsSync(join(repo.cwd, from)),
            existsSync(join(repo.cwd, to)),
            readFileSync(join(repo.cwd, second), 'utf8'),
            readFileSync(join(repo.cwd, first), 'utf8'),
            failure instanceof Error &&
              (restorationFails
                ? failure.message.includes('restoration incomplete') &&
                  failure.message.includes(first)
                : failure.message.includes('all completed changes restored')),
          ],
          expected: [
            true,
            false,
            before,
            restorationFails ? after : before,
            true,
          ],
        });
      } finally {
        repo.cleanup();
      }
    });
  }
  test('preserves a qualified landed migration identity in the other database', () => {
    const repo = repository();
    try {
      repo.write(participant, '20261120000000_next', 'p-next', 'p-base');
      const proof = join(repo.cwd, 'proof.integration.ts');
      writeFileSync(
        proof,
        `const pending='${participant}/20261120000000_next/migration.sql';\nconst landed='${admin}/20261120000000_next/migration.sql';\n`,
      );
      const result = repo.prepare();
      assert({
        given:
          'the same original tag identifies a pending participant migration and a landed admin migration',
        should: 'rewrite only the qualified pending identity',
        actual: [
          result.problems,
          readFileSync(proof, 'utf8'),
          existsSync(join(repo.cwd, admin, '20261120000000_next')),
          repo.git(
            'diff',
            '--name-only',
            repo.base,
            '--',
            `${admin}/20261120000000_next`,
          ),
        ],
        expected: [
          [],
          `const pending='${participant}/20261121000001_next/migration.sql';\nconst landed='${admin}/20261120000000_next/migration.sql';\n`,
          true,
          '',
        ],
      });
    } finally {
      repo.cleanup();
    }
  });

  test('refuses an unqualified identity shared by a landed and pending migration', () => {
    const repo = repository();
    try {
      repo.write(participant, '20261120000000_next', 'p-next', 'p-base');
      const proof = join(repo.cwd, 'proof.integration.ts');
      const before = "const migration='20261120000000_next';\n";
      writeFileSync(proof, before);
      const result = repo.prepare();
      assert({
        given: 'a bare tag has distinct landed and pending destinations',
        should: 'report ambiguity before changing any folder or proof',
        actual: [
          result.problems.some((problem) => problem.includes('ambiguous')),
          existsSync(join(repo.cwd, participant, '20261120000000_next')),
          readFileSync(proof, 'utf8'),
        ],
        expected: [true, true, before],
      });
    } finally {
      repo.cleanup();
    }
  });

  test('rewrites original spans once when one replacement equals another old tag', () => {
    const repo = repository('20261122000000_admin');
    try {
      repo.write(participant, '20261120000000_next', 'p-next', 'p-base');
      repo.write(admin, '20261121000001_next', 'a-next', 'a-base');
      const proof = join(repo.cwd, 'proof.integration.ts');
      writeFileSync(
        proof,
        "const participant='20261120000000_next';\nconst admin='20261121000001_next';\n",
      );
      const result = repo.prepare();
      assert({
        given:
          'two valid database chains where the first new name equals the second old name',
        should: 'retain both distinct rewritten identities without cascading',
        actual: [
          result.problems,
          readFileSync(proof, 'utf8'),
          existsSync(join(repo.cwd, participant, '20261121000001_next')),
          existsSync(join(repo.cwd, admin, '20261122000001_next')),
        ],
        expected: [
          [],
          "const participant='20261121000001_next';\nconst admin='20261122000001_next';\n",
          true,
          true,
        ],
      });
    } finally {
      repo.cleanup();
    }
  });

  test('restores folders and completed proof writes after a read-only proof refuses', () => {
    const repo = repository('20261122000000_admin');
    try {
      repo.write(participant, '20261120000000_next', 'p-next', 'p-base');
      const before = "const migration='20261120000000_next';\n";
      const first = join(repo.cwd, 'a-proof.integration.ts'),
        second = join(repo.cwd, 'z-proof.integration.ts');
      writeFileSync(first, before);
      writeFileSync(second, before);
      chmodSync(second, 0o444);
      let error: unknown;
      try {
        repo.prepare();
      } catch (caught) {
        error = caught;
      }
      assert({
        given:
          'a later real proof file is read-only after an earlier proof was updated',
        should:
          'restore every folder and completed proof independently and report the failure',
        actual: [
          error instanceof Error,
          existsSync(join(repo.cwd, participant, '20261120000000_next')),
          existsSync(join(repo.cwd, participant, '20261121000001_next')),
          readFileSync(first, 'utf8'),
          readFileSync(second, 'utf8'),
        ],
        expected: [true, true, false, before, before],
      });
    } finally {
      repo.cleanup();
    }
  });

  test('policy rejects a malformed-only ADR addition', () => {
    const repo = repository();
    try {
      mkdirSync(join(repo.cwd, 'docs/decisions'), { recursive: true });
      writeFileSync(
        join(repo.cwd, 'docs/decisions/868-new.md'),
        '# New\n\nStatus: proposed.\n',
      );
      const result = prDecisionProblems(
        { GITHUB_REF: 'refs/pull/868/merge', GITHUB_BASE_REF: 'main' },
        repo.cwd,
      );
      assert({
        given: 'the only new decision Markdown has a malformed filename',
        should: 'run ownership validation rather than take the empty fast path',
        actual: result.some((problem) => problem.includes('868-new.md')),
        expected: true,
      });
    } finally {
      repo.cleanup();
    }
  });

  test('policy retains child ownership through GitHub synthetic merge checkout', () => {
    const repo = repository();
    try {
      repo.git('checkout', '-qb', 'child');
      mkdirSync(join(repo.cwd, 'docs/decisions'), { recursive: true });
      writeFileSync(
        join(repo.cwd, 'docs/decisions/0868-new.md'),
        '# 0868: New\n\nStatus: accepted.\n',
      );
      repo.git('add', '.');
      repo.git('commit', '-qm', 'child');
      repo.git('checkout', '-qb', 'parent', repo.base);
      repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge pull request #868 from test/child',
        'child',
      );
      const head = repo.git('rev-parse', 'HEAD');
      repo.git('checkout', '-qb', 'synthetic', repo.base);
      repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        `Merge ${head} into ${repo.base}`,
        'parent',
      );
      const synthetic = repo.git('rev-parse', 'HEAD');
      const event = join(repo.cwd, 'event.json');
      writeFileSync(
        event,
        JSON.stringify({ number: 819, pull_request: { head: { sha: head } } }),
      );
      const env = {
        GITHUB_REF: 'refs/pull/819/merge',
        GITHUB_BASE_REF: 'main',
        GITHUB_SHA: synthetic,
      };
      assert({
        given:
          'CI checks a synthetic merge above a parent containing a child-owned ADR',
        should:
          'inspect the pinned PR head, retaining the child number with or without the event-file fallback',
        actual: [
          prDecisionProblems({ ...env, GITHUB_EVENT_PATH: event }, repo.cwd),
          prDecisionProblems(env, repo.cwd),
        ],
        expected: [[], []],
      });
    } finally {
      repo.cleanup();
    }
  });
});
