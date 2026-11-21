import { z } from 'zod';

const number = /^[1-9][0-9]*$/;
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const runSchema = z.object({
  head_sha: sha,
  event: z.literal('workflow_dispatch'),
  path: z.string().regex(/^\.github\/workflows\/e2e\.yml(?:@.+)?$/),
  status: z.literal('completed'),
  conclusion: z.enum(['success', 'failure']),
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

export function reviewEvidenceComment({
  prHead,
  run,
  artifacts,
  repositoryUrl,
  runId,
}: {
  prHead: string;
  run: unknown;
  artifacts: unknown;
  repositoryUrl: string;
  runId: string;
}): string {
  const candidate = runSchema.parse(run);
  if (candidate.head_sha !== prHead)
    throw new Error('Browser evidence must match the current PR head');

  const [artifact, ...others] = artifactPages
    .parse(artifacts)
    .flatMap((page) => page.artifacts)
    .filter(
      ({ name, expired }) => name === 'browser-review-evidence' && !expired,
    );
  if (!artifact || others.length > 0)
    throw new Error('Expected one unexpired browser-review-evidence artifact');

  const runUrl = `${repositoryUrl}/actions/runs/${runId}`;
  return [
    '## Browser review evidence',
    '',
    `[Download video, trace and screenshots](${runUrl}/artifacts/${artifact.id})`,
    '',
    `[Browser run](${runUrl}) · ${candidate.conclusion} · \`${prHead}\``,
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
  const body = reviewEvidenceComment({
    prHead,
    run: JSON.parse(
      gh('api', `repos/${repository.nameWithOwner}/actions/runs/${runId}`),
    ),
    artifacts: JSON.parse(
      gh(
        'api',
        '--paginate',
        '--slurp',
        `repos/${repository.nameWithOwner}/actions/runs/${runId}/artifacts`,
      ),
    ),
    repositoryUrl: repository.url,
    runId,
  });
  if (currentHead() !== prHead)
    throw new Error('PR head moved while reading browser evidence');

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
