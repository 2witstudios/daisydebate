#!/usr/bin/env bun
/**
 * The review-record status (ADR 0035). A PR's head SHA gets `review-record`
 * success only from a published independent review record for that exact
 * SHA: its Candidate line names the SHA, the PR, the builder the PR body
 * declares and a different reviewer, and its verdict approves. Only the
 * review-record GitHub App may set the status (the ruleset pins it), and
 * the App's key lives in an environment that only main can use, so this
 * verifier, run from main by .github/workflows/review-record.yml, is the
 * only code that can mint it.
 */
import { pagespaceApi } from './pagespace-docs';

export type RecordPage = {
  readonly id: string;
  readonly title: string;
  readonly content: string;
};
export type PullRequest = {
  readonly number: number;
  readonly headSha: string;
  readonly body: string;
};
export type Verdict = {
  readonly state: 'success' | 'failure' | 'pending';
  readonly description: string;
  readonly recordId?: string;
};

const PAGE_LINK = /pagespace\.ai\/dashboard\/[a-z0-9]+\/([a-z0-9]{20,32})/g;
const CANDIDATE =
  /Candidate:\s*([0-9a-f]{40})\s*·\s*PR #(\d+)\s*·\s*Builder:\s*(\S+)\s*·\s*Reviewer:\s*(\S+)/;
const VERDICT =
  /Verdict[\s\S]*?(ALL RESOLVED|APPROVE WITH MINORS|APPROVE|CHANGES REQUESTED)/;
const COUNTS = /(\d+) blocker \/ (\d+) major \/ (\d+) minor \/ (\d+) nit/;
const APPROVALS = new Set(['ALL RESOLVED', 'APPROVE WITH MINORS', 'APPROVE']);

export function linkedPageIds(texts: readonly string[]): readonly string[] {
  return [
    ...new Set(
      texts.flatMap((text) => [...text.matchAll(PAGE_LINK)].map((m) => m[1])),
    ),
  ];
}

export const declaredBuilder = (body: string): string | undefined =>
  /^\s*Builder:\s*(\S+)/m.exec(body)?.[1];

const plainText = (content: string): string =>
  content.replace(/<[^>]+>/g, '\n').replaceAll('&amp;', '&');

/** Why this record does not approve the PR; undefined when it does. */
function recordProblem(
  pr: PullRequest,
  builder: string,
  text: string,
): string | undefined {
  const candidate = CANDIDATE.exec(text);
  if (!candidate)
    return 'The record has no "Candidate: <sha> · PR #n · Builder: … · Reviewer: …" line';
  const [, sha, number, named, reviewer] = candidate;
  if (sha !== pr.headSha)
    return `The record reviews ${sha.slice(0, 7)}, not ${pr.headSha.slice(0, 7)}`;
  if (Number(number) !== pr.number)
    return `The record reviews PR #${number}, not #${pr.number}`;
  if (named !== builder)
    return `The record names builder ${named}; the PR declares ${builder}`;
  return reviewer === builder
    ? `The reviewer ${reviewer} is the builder of this PR`
    : verdictProblem(text);
}

function verdictProblem(text: string): string | undefined {
  const verdict = VERDICT.exec(text)?.[1];
  if (!verdict || !APPROVALS.has(verdict))
    return `The verdict is not an approval: ${verdict ?? 'none found'}`;
  const counts = COUNTS.exec(text)?.slice(1).map(Number) ?? [];
  const clean = counts.length === 4 && counts.every((count) => count === 0);
  const evidenced =
    /test:integration:?\s*PASS/i.test(text) && /negative control/i.test(text);
  return clean && !evidenced
    ? 'A no-findings verdict needs bun test:integration PASS and a negative control in Gates run'
    : undefined;
}

export function verifyReviewRecord(
  pr: PullRequest,
  records: readonly RecordPage[],
): Verdict {
  const forSha = records.filter(
    (record) =>
      record.title.includes(pr.headSha) ||
      CANDIDATE.exec(plainText(record.content))?.[1] === pr.headSha,
  );
  const [first] = forSha;
  if (!first)
    return {
      state: 'pending',
      description: `No review record for ${pr.headSha.slice(0, 7)} yet`,
    };
  const builder = declaredBuilder(pr.body);
  if (!builder)
    return {
      state: 'failure',
      description: 'The PR body declares no "Builder: <id>" line',
      recordId: first.id,
    };
  const judged = forSha.map((record) => {
    const text = plainText(record.content);
    return { record, text, problem: recordProblem(pr, builder, text) };
  });
  const approved = judged.find((entry) => entry.problem === undefined);
  if (approved) {
    const reviewer = CANDIDATE.exec(approved.text)?.[4];
    const verdict = VERDICT.exec(approved.text)?.[1];
    return {
      state: 'success',
      description: `Independent review by ${reviewer}: ${verdict}`,
      recordId: approved.record.id,
    };
  }
  return {
    state: 'failure',
    description: judged[0].problem ?? 'No approving record',
    recordId: judged[0].record.id,
  };
}

// ------------------------------------------------------------------- edges

type Run = (args: readonly string[]) => { code: number; stdout: string };

const gh: Run = (args) => {
  const result = Bun.spawnSync(['gh', ...args], {
    stdout: 'pipe',
    stderr: 'inherit',
  });
  return { code: result.exitCode, stdout: result.stdout.toString() };
};

function ghJson<T>(args: readonly string[]): T {
  const result = gh(args);
  if (result.code !== 0) throw new Error(`gh ${args[1]} failed`);
  return JSON.parse(result.stdout) as T;
}

async function readRecord(id: string): Promise<RecordPage | undefined> {
  const { apiUrl, headers } = pagespaceApi();
  const response = await fetch(new URL(`/api/pages/${id}`, apiUrl), {
    headers,
    redirect: 'error',
  });
  if (!response.ok) return undefined;
  const page = (await response.json()) as { title?: string; content?: string };
  return { id, title: page.title ?? '', content: page.content ?? '' };
}

export async function main(repository: string, prNumber: number) {
  const pull = ghJson<{ head: { sha: string }; body: string | null }>([
    'api',
    `repos/${repository}/pulls/${prNumber}`,
  ]);
  const comments = ghJson<{ body: string }[]>([
    'api',
    '--paginate',
    `repos/${repository}/issues/${prNumber}/comments`,
  ]);
  const pr = {
    number: prNumber,
    headSha: pull.head.sha,
    body: pull.body ?? '',
  };
  const ids = linkedPageIds([pr.body, ...comments.map((c) => c.body)]);
  const records = (await Promise.all(ids.map(readRecord))).filter(
    (record): record is RecordPage => record !== undefined,
  );
  const verdict = verifyReviewRecord(pr, records);
  const driveUrl = 'https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha';
  ghJson([
    'api',
    '-X',
    'POST',
    `repos/${repository}/statuses/${pr.headSha}`,
    '-f',
    `state=${verdict.state}`,
    '-f',
    'context=review-record',
    '-f',
    `description=${verdict.description.slice(0, 140)}`,
    ...(verdict.recordId
      ? ['-f', `target_url=${driveUrl}/${verdict.recordId}`]
      : []),
  ]);
  process.stdout.write(
    `review-record ${verdict.state} for ${pr.headSha}: ${verdict.description}\n`,
  );
}

if (import.meta.main) {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const prNumber = Number(process.env.REVIEW_PR ?? '');
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !Number.isInteger(prNumber) ||
    prNumber < 1
  ) {
    process.stderr.write(
      'review-record: GITHUB_REPOSITORY and a numeric REVIEW_PR are required\n',
    );
    process.exit(2);
  }
  await main(repository, prNumber);
}
