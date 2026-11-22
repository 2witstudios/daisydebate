import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const number = /^[1-9][0-9]*$/;
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const runSchema = z.object({
  head_sha: sha,
  event: z.literal('workflow_dispatch'),
  path: z.string().regex(/^\.github\/workflows\/e2e\.yml(?:@.+)?$/),
  status: z.literal('completed'),
  run_attempt: z.int().positive(),
  conclusion: z.enum(['success', 'failure', 'cancelled', 'timed_out']),
});
const artifactPages = z.array(
  z.object({
    artifacts: z.array(
      z.object({
        id: z.int().positive(),
        name: z.string(),
        expired: z.boolean(),
      }),
    ),
  }),
);

function reviewEvidenceBundle(artifacts: unknown, attempt: number) {
  const prefix = `browser-review-evidence-attempt-${attempt}`;
  const [artifact, ...others] = artifactPages
    .parse(artifacts)
    .flatMap((page) => page.artifacts)
    .filter(
      ({ name, expired }) =>
        !expired &&
        (name === `${prefix}-success` || name === `${prefix}-failure`),
    );
  if (!artifact || others.length > 0)
    throw new Error(
      `Expected one unexpired browser review bundle from attempt ${attempt}`,
    );

  return artifact;
}

export function reviewEvidenceComment({
  prHead,
  run,
  reviewSpec,
  artifacts,
  repositoryUrl,
  runId,
}: {
  prHead: string;
  reviewSpec: unknown;
  run: unknown;
  artifacts: unknown;
  repositoryUrl: string;
  runId: string;
}): string {
  const capturedSpec = z
    .string()
    .regex(/^e2e\/([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.e2e\.ts$/)
    .parse(reviewSpec);
  const candidate = runSchema.parse(run);
  if (candidate.head_sha !== prHead)
    throw new Error('Browser evidence must match the current PR head');

  const artifact = reviewEvidenceBundle(artifacts, candidate.run_attempt);

  const runUrl = `${repositoryUrl}/actions/runs/${runId}`;
  const browserOutcome = artifact.name.split('-').at(-1);
  return [
    '## Browser review evidence',
    '',
    'Captured test: `' + capturedSpec + '`',
    '',
    `[Download video, trace and screenshots](${runUrl}/artifacts/${artifact.id})`,
    '',
    `[Browser attempt ${candidate.run_attempt}](${runUrl}/attempts/${candidate.run_attempt}) · browser ${browserOutcome} · workflow ${candidate.conclusion} · \`${prHead}\``,
    '',
  ].join('\n');
}

function gh(...args: string[]): string {
  const result = Bun.spawnSync(['gh', ...args], {
    stdout: 'pipe',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) throw new Error('GitHub CLI request failed');
  return result.stdout.toString();
}

if (import.meta.main) {
  const [pr, runId, ...rest] = process.argv.slice(2);
  if (!pr || !runId || rest.length || !number.test(pr) || !number.test(runId))
    throw new Error('Usage: bun review:evidence <pr-number> <browser-run-id>');

  const repository = z
    .object({
      nameWithOwner: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      url: z.url(),
    })
    .parse(JSON.parse(gh('repo', 'view', '--json', 'nameWithOwner,url')));
  const currentHead = () =>
    sha.parse(
      gh(
        'api',
        `repos/${repository.nameWithOwner}/pulls/${pr}`,
        '--jq',
        '.head.sha',
      ).trim(),
    );
  const prHead = currentHead();
  const runPath = `repos/${repository.nameWithOwner}/actions/runs/${runId}`;
  const currentAttempt = () => runSchema.parse(JSON.parse(gh('api', runPath)));
  const run = currentAttempt();
  const artifacts: unknown = JSON.parse(
    gh('api', '--paginate', '--slurp', `${runPath}/artifacts`),
  );
  const selected = reviewEvidenceBundle(artifacts, run.run_attempt);
  const directory = mkdtempSync(join(tmpdir(), 'daisy-review-evidence-'));
  let body: string;
  try {
    gh(
      'run',
      'download',
      runId,
      '--repo',
      repository.nameWithOwner,
      '--name',
      selected.name,
      '--dir',
      directory,
    );
    body = reviewEvidenceComment({
      prHead,
      run,
      reviewSpec: readFileSync(
        join(directory, 'review-spec.txt'),
        'utf8',
      ).trim(),
      artifacts,
      repositoryUrl: repository.url,
      runId,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (currentHead() !== prHead)
    throw new Error('PR head moved while reading browser evidence');
  if (currentAttempt().run_attempt !== run.run_attempt)
    throw new Error('Browser run was retried while reading evidence');

  const posted = Bun.spawnSync(
    [
      'gh',
      'pr',
      'comment',
      pr,
      '--repo',
      repository.nameWithOwner,
      '--body-file',
      '-',
    ],
    { stdin: Buffer.from(body), stdout: 'inherit', stderr: 'inherit' },
  );
  process.exitCode = posted.exitCode;
}
