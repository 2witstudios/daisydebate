import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  findChainProblems,
  findHistoryProblems,
  migrationFolders,
  parseLsTree,
  parseSnapshotLink,
  readMigrations,
} from './check-migrations';
import { pendingMigrationPlan } from './pending-migration-stamps';
import { landedAdrFiles, pendingAdrProblems } from './pr-decision-numbers';
import { pendingMigrationReferences } from './pending-migration-references';
import { applyPendingPreparation } from './pending-preparation-writes';

/** Prepare pending names only. No DDL, snapshot rewriting or Git commits. */
export function preparePendingPr(
  options: {
    readonly number: number;
    readonly baseRef: string;
    readonly check: boolean;
  },
  cwd = process.cwd(),
) {
  if (
    !Number.isSafeInteger(options.number) ||
    options.number <= 0 ||
    !options.baseRef ||
    options.baseRef.startsWith('-')
  )
    return {
      renames: [],
      references: [],
      problems: ['A valid owning PR and destination ref are required'],
    };
  const run = (args: readonly string[]) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error('Could not inspect migration history');
    return result.stdout.trim();
  };
  const problems: string[] = [];
  const renames: { from: string; to: string }[] = [];
  const migrationIdentities: string[] = [];
  const baseFiles = run([
    'ls-tree',
    '-r',
    '--name-only',
    options.baseRef,
    '--',
    'docs/decisions',
  ])
    .split('\n')
    .filter(Boolean);
  const currentFiles = run([
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'docs/decisions',
  ])
    .split('\n')
    .filter(Boolean);
  problems.push(
    ...pendingAdrProblems(
      options.number,
      [...baseFiles, ...landedAdrFiles(cwd, currentFiles)],
      currentFiles,
    ),
  );
  for (const folder of migrationFolders) {
    const base = readMigrations(
      parseLsTree(
        run(['ls-tree', '-r', options.baseRef, '--', folder]),
        folder,
      ),
      folder,
    );
    const currentFiles = existsSync(join(cwd, folder))
      ? readdirSync(join(cwd, folder), { withFileTypes: true }).flatMap(
          (entry) =>
            entry.isDirectory()
              ? readdirSync(join(cwd, folder, entry.name)).map(
                  (name) => `${entry.name}/${name}`,
                )
              : [entry.name],
        )
      : [];
    const current = readMigrations(
      currentFiles.map((path) => ({
        path,
        blob: run(['hash-object', '--', join(cwd, folder, path)]),
      })),
      folder,
    );
    problems.push(
      ...base.problems.map((problem) => problem.detail),
      ...current.problems
        .filter((problem) => problem.code !== 'DUPLICATE_TIMESTAMP')
        .map((problem) => problem.detail),
    );
    const byTag = new Map(
      current.migrations.map((migration) => [migration.tag, migration]),
    );
    migrationIdentities.push(
      ...current.migrations.map(({ tag }) => `${folder}/${tag}`),
    );
    for (const landed of base.migrations) {
      const present = byTag.get(landed.tag);
      if (
        !present ||
        present.sql !== landed.sql ||
        present.snapshot !== landed.snapshot
      )
        problems.push(
          `${folder}/${landed.tag}: landed migration history changed; no writes permitted`,
        );
    }
    const baseTags = new Set(base.migrations.map((migration) => migration.tag));
    const baseLinks = base.migrations.map((migration) =>
      parseSnapshotLink(
        migration.tag,
        run([
          'show',
          `${options.baseRef}:${folder}/${migration.tag}/snapshot.json`,
        ]),
      ),
    );
    problems.push(
      ...findChainProblems(baseLinks).map((problem) => problem.detail),
    );
    const pending = current.migrations
      .filter((migration) => !baseTags.has(migration.tag))
      .map((migration) =>
        parseSnapshotLink(
          migration.tag,
          readFileSync(
            join(cwd, folder, migration.tag, 'snapshot.json'),
            'utf8',
          ),
        ),
      );
    const plan = pendingMigrationPlan(baseLinks, pending);
    problems.push(...plan.problems.map((problem) => `${folder}: ${problem}`));
    renames.push(
      ...plan.renames.map(({ from, to }) => ({
        from: `${folder}/${from}`,
        to: `${folder}/${to}`,
      })),
    );
  }
  for (const { to } of renames)
    if (existsSync(join(cwd, to)))
      problems.push(`${to} already exists; no migration names changed`);
  const changed = new Set([
    ...run(['diff', '--name-only', options.baseRef]).split('\n'),
    ...run(['ls-files', '--others', '--exclude-standard']).split('\n'),
  ]);
  const sources: { path: string; text: string }[] = [];
  for (const path of changed) {
    if (
      !/\.(?:[cm]?[jt]sx?|md|json|ya?ml|sh)$/.test(path) ||
      migrationFolders.some((folder) => path.startsWith(`${folder}/`)) ||
      !existsSync(join(cwd, path)) ||
      !lstatSync(join(cwd, path)).isFile()
    )
      continue;
    sources.push({ path, text: readFileSync(join(cwd, path), 'utf8') });
  }
  const targets = new Map(renames.map(({ from, to }) => [from, to]));
  const referencePlan = pendingMigrationReferences(
    migrationIdentities.map((from) => ({
      from,
      to: targets.get(from) ?? from,
    })),
    sources,
  );
  problems.push(...referencePlan.problems);
  const references = referencePlan.updates;
  if (!problems.length && !options.check)
    applyPendingPreparation(cwd, renames, references);
  return { renames, references: references.map(({ path }) => path), problems };
}

/** Qualified-head preflight reads Git objects, never another checkout. */
export function committedPreparationProblems(
  number: number,
  baseRef: string,
  headRef: string,
  cwd = process.cwd(),
): readonly string[] {
  const git = (args: readonly string[]) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error('Cannot inspect the qualified migration candidate');
    return result.stdout.trim();
  };
  const list = (ref: string) =>
    git(['ls-tree', '-r', '--name-only', ref, '--', 'docs/decisions'])
      .split('\n')
      .filter(Boolean);
  // A parent retains records already merged through their originating PRs.
  const problems = pendingAdrProblems(
    number,
    [...list(baseRef), ...landedAdrFiles(cwd, list(headRef), headRef)],
    list(headRef),
  );
  for (const folder of migrationFolders) {
    const base = readMigrations(
      parseLsTree(git(['ls-tree', '-r', baseRef, '--', folder]), folder),
      folder,
    );
    const head = readMigrations(
      parseLsTree(git(['ls-tree', '-r', headRef, '--', folder]), folder),
      folder,
    );
    problems.push(
      ...base.problems.map(({ detail }) => detail),
      ...head.problems.map(({ detail }) => detail),
      ...findHistoryProblems(base.migrations, head.migrations).map(
        ({ detail }) => detail,
      ),
    );
    const links = head.migrations.map(({ tag, snapshot }) =>
      parseSnapshotLink(tag, git(['cat-file', '-p', snapshot])),
    );
    problems.push(...findChainProblems(links).map(({ detail }) => detail));
    const baseTags = new Set(base.migrations.map(({ tag }) => tag));
    const plan = pendingMigrationPlan(
      links.filter(({ tag }) => baseTags.has(tag)),
      links.filter(({ tag }) => !baseTags.has(tag)),
    );
    problems.push(
      ...plan.problems,
      ...plan.renames.map(
        ({ from }) =>
          `${folder}/${from} requires bun pr:prepare before qualification`,
      ),
    );
  }
  return problems;
}

if (import.meta.main) {
  const number = Number(process.argv[2]);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error(
      'Usage: bun pr:prepare <pr-number> [--check] [--base <destination-ref>]',
    );
  const baseIndex = process.argv.indexOf('--base');
  const baseRef = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;
  if (!baseRef)
    throw new Error('An explicit destination --base ref is required');
  const context = spawnSync(
    'gh',
    [
      'pr',
      'view',
      String(number),
      '--json',
      'number,headRefName,baseRefName,state',
    ],
    { encoding: 'utf8' },
  );
  if (context.status !== 0)
    throw new Error('Open the owning PR before preparing its pending changes');
  const pr = JSON.parse(context.stdout) as {
    number: number;
    headRefName: string;
    baseRefName: string;
    state: string;
  };
  const branch = spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
  });
  if (
    pr.number !== number ||
    pr.state !== 'OPEN' ||
    branch.status !== 0 ||
    pr.headRefName !== branch.stdout.trim() ||
    baseRef !== `origin/${pr.baseRefName}`
  )
    throw new Error(
      'Preparation requires this open PR checkout and its actual destination ref',
    );
  const fetch = spawnSync(
    'git',
    [
      'fetch',
      'origin',
      `+refs/heads/${pr.baseRefName}:refs/remotes/origin/${pr.baseRefName}`,
    ],
    { stdio: 'inherit' },
  );
  if (fetch.status !== 0)
    throw new Error(
      'Cannot refresh the PR destination; no pending names changed',
    );
  const result = preparePendingPr(
    { number, baseRef, check: process.argv.includes('--check') },
    resolve(import.meta.dir, '..'),
  );
  console.log(JSON.stringify(result, null, 2));
  if (
    result.problems.length ||
    (process.argv.includes('--check') && result.renames.length)
  )
    process.exitCode = 1;
}
