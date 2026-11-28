#!/usr/bin/env bun
/**
 * Shows that the round oracle's walks are a net of their own (R4.1): each
 * mutation below breaks the engine in a way the engine's unit tests, the
 * golden format corpus, `bun invariants` and the oracle's own fixed cases
 * all miss, and only the generated walks catch. Run it by hand through the
 * heavy queue: `bun oracle:sabotage` (`--only <name>` runs one).
 *
 * It runs against the committed HEAD in a temporary git worktree, never the
 * checkout: each mutation is applied there, checked and reverted before the
 * next, and the worktree is removed at the end. A mutation whose text no
 * longer occurs once is a failure: the engine moved, so the mutation must be
 * re-aimed, never skipped.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Mutation = {
  readonly name: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
};

const mutations: readonly Mutation[] = [
  {
    name: 'the clock runs in an ended Round',
    file: 'packages/debate-engine/src/round-clock.ts',
    find: "    state.lifecycle.status !== 'active' ||",
    replace: "    state.lifecycle.status === 'opening' ||",
  },
  {
    name: 'a panel completes a debate still in its countdown',
    file: 'packages/debate-engine/src/round-panel-completion.ts',
    find: '  debateIsOver(step, rules);',
    replace: '  true;',
  },
  {
    name: 'an ending leaves prep running',
    file: 'packages/debate-engine/src/round-commands.ts',
    find: "  closed = withCheckpoint(closed, {\n    prep: { phase: 'idle' },\n    point_of_information: { phase: 'none' },\n  });",
    replace:
      "  closed = withCheckpoint(closed, {\n    point_of_information: { phase: 'none' },\n  });",
  },
  {
    name: 'a format with no yield policy takes a yield',
    file: 'packages/debate-engine/src/round-command-legality.ts',
    find: '  return rules.interaction.yield?.allowed === true',
    replace: '  return rules.interaction.yield?.allowed !== false',
  },
];

const checkout = resolve(import.meta.dir, '..');

type Run = { readonly ok: boolean; readonly output: string };

const run = (cmd: readonly string[], cwd: string): Run => {
  const result = Bun.spawnSync([...cmd], {
    cwd,
    // One fixed rotating seed, so a sabotage run replays exactly.
    env: { ...process.env, ROUND_ORACLE_SEED: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    ok: result.exitCode === 0,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

const failedTests = (output: string): string[] =>
  output
    .split('\n')
    .filter((line) => line.startsWith('(fail) '))
    .map((line) => line.slice('(fail) '.length).replace(/ \[[\d.]+m?s\]$/, ''));

const walkTests =
  'generated walks hold every invariant|the walks reach every part of the Round';

const seedsOf = (output: string): string[] => [
  ...new Set(
    [...output.matchAll(/seed (\d+), path ([\d:]+): ([^"\n]*)/g)].map(
      ([, seed, path, problem]) =>
        `seed ${seed}, path ${path}\n  found: ${problem}`,
    ),
  ),
];

const check = (root: string, mutation: Mutation): string[] => {
  const path = resolve(root, mutation.file);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(mutation.find).length - 1;
  if (occurrences !== 1)
    return [
      `${mutation.name}: its text occurs ${occurrences} times in ${mutation.file}; re-aim it`,
    ];
  writeFileSync(path, original.replace(mutation.find, mutation.replace));
  try {
    const caughtBy = (net: string, result: Run) =>
      result.ok
        ? []
        : [
            `${mutation.name}: ${net} catches it (${failedTests(result.output).slice(0, 2).join('; ') || 'see its output'})`,
          ];
    // The cheap nets first: a mutation any of them catches is not walk-only.
    const earlier = [
      ...caughtBy(
        "the engine's unit tests",
        run(['bun', 'test', 'src'], resolve(root, 'packages/debate-engine')),
      ),
      ...caughtBy(
        'the golden corpus',
        run(
          ['bun', 'test', 'src/test-support/format-corpus'],
          resolve(root, 'apps/web'),
        ),
      ),
      ...caughtBy(
        'bun invariants',
        run(['bun', 'scripts/invariants.ts'], root),
      ),
      ...caughtBy(
        "the oracle's fixed cases",
        run(
          [
            'bun',
            'test',
            'scripts/round-oracle.test.ts',
            '-t',
            `^(?!.*(${walkTests})).*$`,
          ],
          root,
        ),
      ),
    ];
    if (earlier.length > 0) return earlier;
    // The walks stop at their first failure: shrinking every format is slow.
    const walks = run(
      [
        'bun',
        'test',
        'scripts/round-oracle.test.ts',
        '--bail',
        '-t',
        'generated walks hold every invariant',
      ],
      root,
    );
    if (walks.ok) return [`${mutation.name}: no walk catches it`];
    console.log(
      `CAUGHT ONLY BY A WALK  ${mutation.name}\n  first: ${failedTests(walks.output)[0] ?? 'a walk'}\n  ${seedsOf(walks.output)[0] ?? ''}`,
    );
    return [];
  } finally {
    writeFileSync(path, original);
  }
};

if (import.meta.main) {
  const only = process.argv.indexOf('--only');
  const chosen =
    only === -1
      ? mutations
      : mutations.filter(({ name }) => name === process.argv[only + 1]);
  if (chosen.length === 0) {
    console.error('No mutation matches');
    process.exit(1);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'round-oracle-sabotage-'));
  const git = (...args: string[]) => run(['git', ...args], checkout);
  const remove = () => git('worktree', 'remove', '--force', scratch);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      remove();
      process.exit(130);
    });
  const added = git('worktree', 'add', '--detach', scratch, 'HEAD');
  if (!added.ok) throw new Error(added.output);
  let problems: string[] = [];
  try {
    const installed = run(['bun', 'install', '--frozen-lockfile'], scratch);
    if (!installed.ok) throw new Error(installed.output);
    problems = chosen.flatMap((mutation) => {
      const found = check(scratch, mutation);
      for (const problem of found) console.error(`NOT SHOWN  ${problem}`);
      return found;
    });
  } finally {
    remove();
  }
  process.exit(problems.length === 0 ? 0 : 1);
}
