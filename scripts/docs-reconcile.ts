#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assessEventText,
  parseRunRecord,
  type DocumentationRunRecord,
} from './docs-contracts';
import {
  createDocumentationEvent,
  parseChangedFiles,
  type DocumentationEvent,
  type DocumentPipeline,
} from './docs-pipeline';
import { DOCUMENTATION_PROMPT_VERSION } from './docs-prompts';
import { extractTaskIds } from './notify-drive';

const root = resolve(import.meta.dir, '..');

export type MergedPullRequest = {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly url: string;
  readonly author: string | null;
  readonly mergedBy: string | null;
  readonly repository: string;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly mergeCommitSha: string;
  readonly mergedAt: string;
  readonly fork: boolean;
  readonly changedFiles: readonly string[];
};

export type UncoveredPipeline = {
  readonly pullRequest: number;
  readonly url: string;
  readonly sourceSnapshot: string;
  readonly pipeline: DocumentPipeline;
};

// The merge workflow sanitizes before it classifies (scripts/dispatch-docs.ts),
// so reconciliation must sanitize in the same order or a long body's keyword
// classifies here and vanishes there.
const eventFor = (
  pullRequest: MergedPullRequest,
): DocumentationEvent | undefined => {
  if (pullRequest.fork) return undefined;
  const assessed = assessEventText({
    title: pullRequest.title,
    body: pullRequest.body,
  });
  const event = createDocumentationEvent({
    eventId: `${pullRequest.id}-${pullRequest.mergeCommitSha}`,
    eventType: 'pull_request.merged',
    occurredAt: pullRequest.mergedAt,
    repository: pullRequest.repository,
    baseRef: pullRequest.baseRef,
    commit: pullRequest.mergeCommitSha,
    pullRequest: {
      number: pullRequest.number,
      title: assessed.title,
      body: assessed.body === '' ? null : assessed.body,
      url: pullRequest.url,
      author: pullRequest.author,
      mergedBy: pullRequest.mergedBy,
    },
    taskIds: extractTaskIds([assessed.title, assessed.body].join(' ')),
    changedFiles: parseChangedFiles(pullRequest.changedFiles.join('\n')),
    promptVersion: DOCUMENTATION_PROMPT_VERSION,
    textRisk: assessed.textRisk,
    textRiskReasons: assessed.reasons,
  });
  return event.classification.pipelines.length > 0 ? event : undefined;
};

export function expectedEvents(
  pullRequests: readonly MergedPullRequest[],
): readonly DocumentationEvent[] {
  return pullRequests
    .map(eventFor)
    .filter((event): event is DocumentationEvent => event !== undefined);
}

export function selectReconcilableMerges(input: {
  readonly pullRequests: readonly MergedPullRequest[];
  readonly now: number;
  readonly sinceMs: number;
  readonly graceMs: number;
}): readonly MergedPullRequest[] {
  const oldest = input.now - input.sinceMs;
  const youngest = input.now - input.graceMs;
  return input.pullRequests.filter((pullRequest) => {
    const mergedAt = Date.parse(pullRequest.mergedAt);
    return (
      Number.isFinite(mergedAt) && mergedAt >= oldest && mergedAt <= youngest
    );
  });
}

// A record only vouches for the workflow that wrote it: a merge routed to two
// pipelines needs two receipts, and a failed run is not a receipt at all.
export function findMissingRuns(input: {
  readonly expected: readonly DocumentationEvent[];
  readonly runRecords: readonly DocumentationRunRecord[];
}): readonly UncoveredPipeline[] {
  const covered = new Set(
    input.runRecords
      .filter((record) => record.status !== 'failed')
      .map((record) => `${record.sourceSnapshot}::${record.workflow}`),
  );
  const uncovered: UncoveredPipeline[] = [];
  for (const event of input.expected) {
    const sourceSnapshot = `${event.repository}@${event.commit}`;
    for (const pipeline of event.classification.pipelines)
      if (!covered.has(`${sourceSnapshot}::${pipeline}`))
        uncovered.push({
          pullRequest: event.pullRequest?.number ?? 0,
          url: event.pullRequest?.url ?? '',
          sourceSnapshot,
          pipeline,
        });
  }
  return uncovered;
}

export function composeReconcileMessage(
  uncovered: readonly UncoveredPipeline[],
): string {
  return [
    `🔴 Documentation freshness: ${uncovered.length} uncovered ${
      uncovered.length === 1 ? 'pipeline' : 'pipelines'
    } with no run record`,
    ...uncovered.map(
      (entry) =>
        `#${entry.pullRequest} ${entry.pipeline} — ${entry.sourceSnapshot} (${entry.url})`,
    ),
    'Replay with `bun docs:dispatch` after confirming the agent writes run records.',
  ].join('\n');
}

const DURATION_PATTERN = /^(\d+)([hd])$/;

export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value);
  if (!match)
    throw new Error(`Duration must look like 24h or 7d, got ${value}`);
  const count = Number(match[1]);
  return count * (match[2] === 'h' ? 3_600_000 : 86_400_000);
}

const gh = (args: readonly string[]): string =>
  execFileSync('gh', [...args], { cwd: root, encoding: 'utf8' });

const changedFilesBetween = (
  base: string,
  merge: string,
): readonly string[] => {
  const diff = execFileSync('git', ['diff', '--name-only', base, merge], {
    cwd: root,
    encoding: 'utf8',
  });
  return parseChangedFiles(diff);
};

type GhPullRequest = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  user: { login: string } | null;
  merged_by: { login: string } | null;
  base: { ref: string; sha: string };
  head: { repo: { fork: boolean } | null };
};

export function fetchMergedPullRequests(
  repository: string,
): readonly MergedPullRequest[] {
  const raw = gh([
    'api',
    '--paginate',
    `repos/${repository}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
  ]);
  const pullRequests = JSON.parse(raw) as GhPullRequest[];
  return pullRequests
    .filter(
      (pullRequest) => pullRequest.merged_at && pullRequest.merge_commit_sha,
    )
    .map((pullRequest) => ({
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      body: pullRequest.body,
      url: pullRequest.html_url,
      author: pullRequest.user?.login ?? null,
      mergedBy: pullRequest.merged_by?.login ?? null,
      repository,
      baseRef: pullRequest.base.ref,
      baseSha: pullRequest.base.sha,
      mergeCommitSha: pullRequest.merge_commit_sha as string,
      mergedAt: pullRequest.merged_at as string,
      fork: pullRequest.head.repo?.fork ?? true,
      changedFiles: changedFilesBetween(
        pullRequest.base.sha,
        pullRequest.merge_commit_sha as string,
      ),
    }));
}

async function readRunRecords(path: string): Promise<DocumentationRunRecord[]> {
  const raw = JSON.parse(await readFile(resolve(root, path), 'utf8'));
  if (!Array.isArray(raw))
    throw new Error(`${path} must hold a JSON array of run records`);
  return raw.map(parseRunRecord);
}

const flagValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

async function main(): Promise<void> {
  // The PageSpace read surface for the Documentation Runs page is not yet
  // proven from CI, so records arrive by file. Missing input is a hard error:
  // an empty sweep must never be mistaken for a clean one.
  const recordsPath = flagValue('run-records');
  if (!recordsPath)
    throw new Error(
      '--run-records <path> is required; a sweep without records cannot prove freshness',
    );
  const repository = flagValue('repository') ?? '2witstudios/daisydebate';
  const sinceMs = parseDuration(flagValue('since') ?? '24h');
  const graceMs = parseDuration(flagValue('grace') ?? '1h');

  const merges = selectReconcilableMerges({
    pullRequests: fetchMergedPullRequests(repository),
    now: Date.now(),
    sinceMs,
    graceMs,
  });
  const expected = expectedEvents(merges);
  const uncovered = findMissingRuns({
    expected,
    runRecords: await readRunRecords(recordsPath),
  });

  if (process.argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ merges: merges.length, expected, uncovered }, null, 2)}\n`,
    );
    return;
  }
  process.stdout.write(
    uncovered.length === 0
      ? `Documentation freshness: ${expected.length} expected events, all covered\n`
      : `${composeReconcileMessage(uncovered)}\n`,
  );
}

if (import.meta.main) {
  await main();
}
