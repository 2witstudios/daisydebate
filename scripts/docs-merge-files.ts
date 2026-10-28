#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseChangedFiles } from './docs-pipeline';

const MERGE_SHA = /^[0-9a-f]{40}$/;

// A merge's own change: its first parent is main just before the merge. The
// PR's base.sha is only the base at its last sync, so diffing from it also
// listed everything main gained since (PR #497: 203 files for its own 17),
// and the Documentation Agent spent its run reviewing other merges' paths.
// notify-merge, docs-replay and docs:reconcile all read changed files here,
// so the event and the reconciler's expectation cannot disagree.
export function mergeChangedFiles(
  mergeCommitSha: string,
  cwd = resolve(import.meta.dir, '..'),
): readonly string[] {
  if (!MERGE_SHA.test(mergeCommitSha))
    throw new Error('A merge commit must be a 40-character hex sha');
  return parseChangedFiles(
    execFileSync(
      'git',
      ['diff', '--name-only', `${mergeCommitSha}^1`, mergeCommitSha],
      { cwd, encoding: 'utf8' },
    ),
  );
}

if (import.meta.main) {
  const [mergeCommitSha = ''] = process.argv.slice(2);
  process.stdout.write(mergeChangedFiles(mergeCommitSha).join(','));
}
