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
const VERDICT_HEADING = /^#*\s*Verdict$/;
const VERDICT_LINE =
  /^(\d+) blockers? \/ (\d+) majors? \/ (\d+) minors? \/ (\d+) nits? — (.+)$/;
const APPROVALS = new Set(['APPROVE', 'APPROVE WITH MINORS']);

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

const textLines = (text: string): readonly string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/**
 * The record's verdict: the line right after its last Verdict heading and
 * nothing else, so findings that quote a verdict or the contract's list of
 * verdicts never count.
 */
function finalVerdict(text: string) {
  const lines = textLines(text);
  const heading = lines.findLastIndex((line) => VERDICT_HEADING.test(line));
  const match =
    heading === -1 ? null : VERDICT_LINE.exec(lines[heading + 1] ?? '');
  if (!match) return undefined;
  const [blockers, majors, minors, nits] = match.slice(1, 5).map(Number);
  return { blockers, majors, minors, nits, verdict: match[5].trim() };
}

/** Gates run evidence, each on its own line: `<gate>: PASS …`, `… run: yes`. */
const gateLine = (text: string, gate: RegExp): boolean =>
  textLines(text).some((line) => gate.test(line));

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
  const final = finalVerdict(text);
  if (!final)
    return 'The record has no "n blocker / n major / n minor / n nit — <verdict>" line under Verdict';
  if (!APPROVALS.has(final.verdict))
    return `The verdict is not an approval: ${final.verdict}`;
  if (final.blockers > 0 || final.majors > 0)
    return `The verdict approves with ${final.blockers} blocker and ${final.majors} major open`;
  const clean = final.minors === 0 && final.nits === 0;
  const evidenced =
    gateLine(text, /^bun test:integration:\s*PASS\b(?!\?)/) &&
    gateLine(text, /^Negative control run:\s*yes\b/i);
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
  // Every record for this SHA must approve: one reviewer's approval does
  // not outvote another's request for changes.
  const refused = judged.find((entry) => entry.problem !== undefined);
  if (refused)
    return {
      state: 'failure',
      description: refused.problem ?? 'No approving record',
      recordId: refused.record.id,
    };
  const [approved] = judged;
  return {
    state: 'success',
    description: `Independent review by ${CANDIDATE.exec(approved.text)?.[4]}: ${finalVerdict(approved.text)?.verdict}`,
    recordId: approved.record.id,
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
