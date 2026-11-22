import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { pendingMigrationPlan } from './pending-migration-stamps';
import {
  newAdrPath,
  pendingAdrProblems,
  prDecisionProblems,
} from './pr-decision-numbers';
import { committedPreparationProblems, preparePendingPr } from './prepare-pr';

setupRitewayBun();

describe('pending migration order', () => {
  test('restamps only pending folders in snapshot dependency order', () => {
    assert({
      given:
        'a landed predecessor and two pending folders with colliding old timestamps',
      should:
        'append pending folders deterministically without changing snapshot identities',
      actual: pendingMigrationPlan(
        [{ tag: '20261122100000_base', id: 'base', prevIds: ['origin'] }],
        [
          { tag: '20261122000000_second', id: 'second', prevIds: ['first'] },
          { tag: '20261122000000_first', id: 'first', prevIds: ['base'] },
        ],
      ),
      expected: {
        renames: [
          { from: '20261122000000_first', to: '20261122100001_first' },
          { from: '20261122000000_second', to: '20261122100002_second' },
        ],
        problems: [],
      },
    });
  });
  test('handles calendar rollover and is idempotent', () => {
    const base = [
      { tag: '20261231235959_base', id: 'base', prevIds: ['origin'] },
    ];
    const pending = [
      { tag: '20261231000000_next', id: 'next', prevIds: ['base'] },
    ];
    assert({
      given: 'a pending migration behind the final second of the year',
      should: 'roll the timestamp into the next year once',
      actual: [
        pendingMigrationPlan(base, pending),
        pendingMigrationPlan(base, [
          { ...pending[0]!, tag: '20270101000000_next' },
        ]),
      ],
      expected: [
        {
          renames: [{ from: '20261231000000_next', to: '20270101000000_next' }],
          problems: [],
        },
        { renames: [], problems: [] },
      ],
    });
  });
  test('refuses divergent or ambiguous snapshot chains', () => {
    const base = [
      { tag: '20261122100000_base', id: 'base', prevIds: ['origin'] },
    ];
    const divergent = pendingMigrationPlan(base, [
      { tag: '20261122000000_next', id: 'next', prevIds: ['old-base'] },
    ]);
    const ambiguous = pendingMigrationPlan(base, [
      { tag: '20261122000000_one', id: 'one', prevIds: ['base'] },
      { tag: '20261122000000_two', id: 'two', prevIds: ['base'] },
    ]);
    assert({
      given: 'snapshots that cannot be appended as one known chain',
      should: 'refuse all renames and request schema reconciliation',
      actual: [
        divergent.renames,
        divergent.problems.length > 0,
        ambiguous.renames,
        ambiguous.problems.length > 0,
      ],
      expected: [[], true, [], true],
    });
  });
});

describe('PR-owned decision numbers', () => {
  test('uses the PR number for a new record and leaves historical records alone', () => {
    assert({
      given: 'a PR-owned record alongside historical records',
      should: 'assign the PR number only to newly introduced paths',
      actual: [
        newAdrPath(868, 'pending-migration-order'),
        pendingAdrProblems(
          868,
          ['docs/decisions/0038-existing.md'],
          [
            'docs/decisions/0038-existing.md',
            'docs/decisions/0868-pending-migration-order.md',
          ],
        ),
        pendingAdrProblems(
          868,
          ['docs/decisions/0038-existing.md'],
          ['docs/decisions/0038-existing.md', 'docs/decisions/0169-new.md'],
        ).length,
      ],
      expected: ['docs/decisions/0868-pending-migration-order.md', [], 1],
    });
  });
});

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), 'prepare-pr-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'test');
  git('config', 'core.hooksPath', '/dev/null');
  const write = (folder: string, tag: string, id: string, previous: string) => {
    const path = join(cwd, folder, tag);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'migration.sql'), `-- ${id}\nSELECT 1;\n`);
    writeFileSync(
      join(path, 'snapshot.json'),
      JSON.stringify(
        {
          id,
          prevIds: [previous],
          dialect: 'postgres',
          version: '8',
          tables: { [id]: { name: id } },
        },
        null,
        2,
      ) + '\n',
    );
  };
  for (const folder of [
    'packages/db/migrations',
    'apps/admin/src/db/migrations',
  ])
    write(
      folder,
      '20261121000000_base',
      'base',
      '00000000-0000-0000-0000-000000000000',
    );
  git('add', '.');
  git('commit', '-qm', 'landed history');
  return {
    cwd,
    git,
    write,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

describe('PR preparation on disposable repository history', () => {
  test('reads complete large landed snapshots at both preparation entry points', () => {
    const repo = repository();
    try {
      const path = join(
        repo.cwd,
        'packages/db/migrations/20261121000000_base/snapshot.json',
      );
      const snapshot = JSON.parse(readFileSync(path, 'utf8'));
      snapshot.largeSchema = 'x'.repeat(2 * 1024 * 1024);
      writeFileSync(path, JSON.stringify(snapshot));
      repo.git('add', '.');
      repo.git('commit', '-qm', 'large landed schema');
      const head = repo.git('rev-parse', 'HEAD');
      assert({
        given:
          'a landed schema snapshot larger than the default subprocess capture buffer',
        should: 'read the complete JSON and leave it unchanged',
        actual: [
          preparePendingPr(
            { number: 868, baseRef: head, check: true },
            repo.cwd,
          ).problems,
          committedPreparationProblems(868, head, head, repo.cwd),
          readFileSync(path, 'utf8') === JSON.stringify(snapshot),
        ],
        expected: [[], [], true],
      });
    } finally {
      repo.cleanup();
    }
  });
  test('policy refuses an unmerged ADR using another PR number', () => {
    const repo = repository();
    try {
      repo.git(
        'update-ref',
        'refs/remotes/origin/main',
        repo.git('rev-parse', 'HEAD'),
      );
      mkdirSync(join(repo.cwd, 'docs/decisions'), { recursive: true });
      writeFileSync(
        join(repo.cwd, 'docs/decisions/0868-new.md'),
        '# 0868: New\n\nStatus: proposed.\n',
      );
      repo.git('add', '.');
      repo.git('commit', '-qm', 'pending decision');
      const problems = prDecisionProblems(
        { GITHUB_REF: 'refs/pull/869/merge', GITHUB_BASE_REF: 'main' },
        repo.cwd,
      );
      assert({
        given: 'a new unmerged ADR whose filename belongs to another PR',
        should: 'refuse it with its location and expected owner number',
        actual: problems.some(
          (problem) =>
            problem.includes('0868-new.md') && problem.includes('869'),
        ),
        expected: true,
      });
    } finally {
      repo.cleanup();
    }
  });
  test('updates pending proof references without changing similar names or the qualified head', () => {
    const repo = repository();
    try {
      const base = repo.git('rev-parse', 'HEAD');
      const tag = '20261120000000_next';
      repo.write('packages/db/migrations', tag, 'next', 'base');
      const proof = join(repo.cwd, 'proof.integration.ts');
      writeFileSync(
        proof,
        `export const migration = '${tag}';\nexport const other = '${tag}_suffix';\n`,
      );
      repo.git('add', '.');
      repo.git('commit', '-qm', 'pending migration');
      const head = repo.git('rev-parse', 'HEAD');
      const refusal = committedPreparationProblems(868, base, head, repo.cwd);
      const prepared = preparePendingPr(
        { number: 868, baseRef: base, check: false },
        repo.cwd,
      );
      const content = readFileSync(proof, 'utf8');
      assert({
        given:
          'a pending folder and its test reference, alongside a similar unrelated name',
        should:
          'refuse the unprepared qualified head, change only the exact pending reference, and never commit changes',
        actual: [
          refusal.length > 0,
          prepared.problems,
          content.includes("'20261121000001_next'"),
          content.includes(`'${tag}_suffix'`),
          repo.git('rev-parse', 'HEAD') === head,
        ],
        expected: [true, [], true, true, true],
      });
    } finally {
      repo.cleanup();
    }
  });

  test('retains the originating child PR number when a parent is reviewed from another checkout head', () => {
    const repo = repository();
    try {
      const base = repo.git('rev-parse', 'HEAD');
      repo.git('update-ref', 'refs/remotes/origin/main', base);
      repo.git('checkout', '-qb', 'child');
      mkdirSync(join(repo.cwd, 'docs/decisions'), { recursive: true });
      writeFileSync(
        join(repo.cwd, 'docs/decisions/0868-new.md'),
        '# 0868: New decision\n\nStatus: accepted.\n',
      );
      repo.git('add', '.');
      repo.git('commit', '-qm', 'child decision');
      repo.git('checkout', '-q', 'main');
      repo.git(
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'Merge pull request #868 from test/child',
        'child',
      );
      const parent = repo.git('rev-parse', 'HEAD');
      const local = prDecisionProblems(
        { GITHUB_REF: 'refs/pull/819/merge', GITHUB_BASE_REF: 'main' },
        repo.cwd,
      );
      repo.git('checkout', '-qb', 'retained-caller', base);
      assert({
        given:
          'a child-owned ADR already merged to the parent, while the caller is on an older retained head',
        should:
          'keep the child number at both policy and committed-candidate preflight',
        actual: [
          local,
          committedPreparationProblems(819, base, parent, repo.cwd),
        ],
        expected: [[], []],
      });
    } finally {
      repo.cleanup();
    }
  });
  test('prepares a second PR after the first lands without renumbering landed history', () => {
    const repo = repository();
    try {
      const folder = 'packages/db/migrations';
      repo.write(folder, '20261122000000_first', 'first', 'base');
      const first = preparePendingPr(
        { number: 868, baseRef: 'main', check: false },
        repo.cwd,
      );
      repo.git('add', '.');
      repo.git('commit', '-qm', 'first PR landed');
      const base = repo.git('rev-parse', 'HEAD');
      repo.write(folder, '20261122000000_second', 'second', 'first');
      const original = readFileSync(
        join(repo.cwd, folder, '20261122000000_second/snapshot.json'),
        'utf8',
      );
      const second = preparePendingPr(
        { number: 869, baseRef: base, check: false },
        repo.cwd,
      );
      const repeated = preparePendingPr(
        { number: 869, baseRef: base, check: false },
        repo.cwd,
      );
      assert({
        given: 'two sequential PRs whose generated folder timestamps collide',
        should:
          'restamp only the second pending folder, preserve every snapshot byte, and report no further edits',
        actual: [
          first.problems,
          second.problems,
          second.renames.length,
          repeated.renames,
          readFileSync(
            join(repo.cwd, folder, '20261122000001_second/snapshot.json'),
            'utf8',
          ) === original,
          repo.git(
            'diff',
            '--name-only',
            base,
            '--',
            `${folder}/20261121000000_base`,
            `${folder}/20261122000000_first`,
          ) === '',
        ],
        expected: [[], [], 1, [], true, true],
      });
    } finally {
      repo.cleanup();
    }
  });
  test('check mode reports changes without writing, and rewritten history refuses all writes', () => {
    const repo = repository();
    try {
      const folder = 'apps/admin/src/db/migrations';
      repo.write(folder, '20261120000000_next', 'next', 'base');
      const check = preparePendingPr(
        { number: 868, baseRef: 'main', check: true },
        repo.cwd,
      );
      const before = readdirSync(join(repo.cwd, folder)).sort();
      writeFileSync(
        join(repo.cwd, folder, '20261121000000_base/migration.sql'),
        'changed landed SQL',
      );
      const refused = preparePendingPr(
        { number: 868, baseRef: 'main', check: false },
        repo.cwd,
      );
      assert({
        given: 'a check-only run followed by a working-tree edit to landed SQL',
        should: 'write nothing in either case and explain the history refusal',
        actual: [
          check.renames.length,
          check.problems,
          refused.problems.length > 0,
          readdirSync(join(repo.cwd, folder)).sort(),
        ],
        expected: [1, [], true, before],
      });
    } finally {
      repo.cleanup();
    }
  });
});
