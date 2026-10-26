/**
 * The Daisy Debate drive and the shared low-level I/O for the review-record
 * check: reading a linked record page from PageSpace, and a PR's live head
 * SHA, body and comments through gh. review-record.ts's pure
 * verifier and its self-check command (`bun review:check`, ISSUE-122) both
 * read through this module, so there is exactly one copy of each call.
 */
import { execFileSync } from 'node:child_process';
import type { CiEvidence, CiJob, CiRun, PullRequestHistory } from './review-ci';
import type { ReviewDiff } from './review-diff';
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
  readonly diff?: ReviewDiff;
  /** The PR's head and base branches and the repository default; CI evidence needs all three. */
  readonly headRef?: string;
  readonly baseRef?: string;
  readonly defaultBranch?: string;
};

/** The Daisy Debate drive: records anywhere else are never read. */
export const DAISY_DRIVE = 'lguvh1y1ejhadk96xcftohha';

type FetchedPage = {
  readonly title?: string;
  readonly content?: string;
  readonly driveId?: string;
};

/**
 * A fetched page as a record, or undefined when it lives outside the Daisy
 * drive: a Daisy-drive link naming another drive's page is not trusted.
 */
export const recordFromPage = (
  id: string,
  page: FetchedPage,
): RecordPage | undefined =>
  page.driveId === DAISY_DRIVE
    ? { id, title: page.title ?? '', content: page.content ?? '' }
    : undefined;

/** Every comment body across the pages gh api --paginate --slurp returns. */
export const commentBodies = (
  pages: readonly (readonly { readonly body: string }[])[],
): string[] => pages.flat().map((comment) => comment.body);

export type Run = (args: readonly string[]) => { code: number; stdout: string };

/** gh as the ambient identity, or as an explicit token when one is given. */
export const ghAs =
  (token?: string): Run =>
  (args) => {
    const result = Bun.spawnSync(['gh', ...args], {
      stdout: 'pipe',
      stderr: 'inherit',
      env: token ? { ...process.env, GH_TOKEN: token } : process.env,
    });
    return { code: result.exitCode, stdout: result.stdout.toString() };
  };

export const gh: Run = ghAs();

export function ghJson<T>(args: readonly string[]): T {
  const result = gh(args);
  if (result.code !== 0) throw new Error(`gh ${args[1]} failed`);
  return JSON.parse(result.stdout) as T;
}

type PrDiffSource = {
  readonly head: { readonly sha: string; readonly ref?: string };
  readonly base: {
    readonly sha: string;
    readonly ref?: string;
    readonly repo?: { readonly default_branch?: string };
  };
  readonly changed_files: number;
};

/** GitHub supplies paths; Git trees supply modes. Incomplete reads never grant docs scope. */
export function readPullRequestDiff(
  run: Run,
  repository: string,
  source: PrDiffSource,
): ReviewDiff | undefined {
  const api = <T>(path: string): T => {
    const result = run(['api', path]);
    if (result.code !== 0) throw new Error('review diff unavailable');
    return JSON.parse(result.stdout) as T;
  };
  try {
    const comparison = api<{
      merge_base_commit: { sha: string };
      files?: {
        filename: string;
        previous_filename?: string;
        status: string;
      }[];
    }>(`repos/${repository}/compare/${source.base.sha}...${source.head.sha}`);
    // Compare's file list is SHA-bound and limited to 300; count mismatch fails closed.
    const files = comparison.files ?? [];
    const tree = (sha: string) =>
      api<{
        truncated: boolean;
        tree: { path: string; mode: string }[];
      }>(`repos/${repository}/git/trees/${sha}?recursive=1`);
    const base = tree(comparison.merge_base_commit.sha);
    const head = tree(source.head.sha);
    const modes = (entries: typeof base.tree) =>
      new Map(entries.map((entry) => [entry.path, entry.mode]));
    const oldModes = modes(base.tree);
    const newModes = modes(head.tree);
    return {
      headSha: source.head.sha,
      complete:
        base.truncated === false &&
        head.truncated === false &&
        files.length === source.changed_files &&
        new Set(files.map((file) => file.filename)).size === files.length,
      files: files.map((file) => ({
        path: file.filename,
        previousPath: file.previous_filename,
        status: file.status,
        oldMode: oldModes.get(file.previous_filename ?? file.filename),
        newMode: newModes.get(file.filename),
      })),
    };
  } catch {
    return undefined;
  }
}

/** The PR's live head SHA, body and every issue-comment body, through gh. */
export function fetchPullRequest(
  repository: string,
  prNumber: number,
): { readonly pr: PullRequest; readonly comments: readonly string[] } {
  const pull = ghJson<PrDiffSource & { body: string | null }>([
    'api',
    `repos/${repository}/pulls/${prNumber}`,
  ]);
  // --slurp wraps every page in one array; without it, more than one page
  // of comments prints several arrays and cannot be parsed.
  const comments = commentBodies(
    ghJson<{ body: string }[][]>([
      'api',
      '--paginate',
      '--slurp',
      `repos/${repository}/issues/${prNumber}/comments`,
    ]),
  );
  return {
    pr: pullRequestFacts(
      prNumber,
      pull,
      readPullRequestDiff(gh, repository, pull),
    ),
    comments,
  };
}

/** The PR facts the verifier reads, from the pulls API response. */
export const pullRequestFacts = (
  prNumber: number,
  pull: PrDiffSource & { readonly body: string | null },
  diff: ReviewDiff | undefined,
): PullRequest => ({
  number: prNumber,
  headSha: pull.head.sha,
  body: pull.body ?? '',
  diff,
  headRef: pull.head.ref,
  baseRef: pull.base.ref,
  defaultBranch: pull.base.repo?.default_branch,
});

type RecordReadOptions = {
  /** Only the local self-check opts in; CI always remains token-only. */
  readonly localCli?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: (url: URL, init: RequestInit) => Promise<Response>;
  /** Throws on missing CLI, nonzero exit, timeout or excessive output. */
  readonly cli?: (args: readonly string[]) => string;
};

const MAX_RECORD_BYTES = 1_048_576;

const pagespaceDetails = (args: readonly string[]): string =>
  execFileSync('pagespace', [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 15_000,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_RECORD_BYTES,
  });

/** Validate full details from either transport before trusting record content. */
function fetchedRecord(id: string, page: unknown): RecordPage | undefined {
  if (
    typeof page !== 'object' ||
    page === null ||
    !('id' in page) ||
    page.id !== id ||
    !('driveId' in page) ||
    page.driveId !== DAISY_DRIVE ||
    !('title' in page) ||
    typeof page.title !== 'string' ||
    !('content' in page) ||
    typeof page.content !== 'string'
  )
    return undefined;
  return { id, title: page.title, content: page.content };
}

/** A linked page, or undefined on any transport, identity or scope failure. */
async function readRecord(
  id: string,
  options: RecordReadOptions,
): Promise<RecordPage | undefined> {
  const env = options.env ?? process.env;
  try {
    // IDs are positional CLI arguments and API path segments, never flags/paths.
    if (!/^[a-z0-9]{20,32}$/.test(id)) return undefined;
    if (
      !env.PAGESPACE_TOKEN &&
      options.localCli &&
      !env.CI &&
      !env.GITHUB_ACTIONS
    ) {
      const stdout = (options.cli ?? pagespaceDetails)([
        'pages',
        'read-details',
        id,
        '--json',
      ]);
      if (Buffer.byteLength(stdout) > MAX_RECORD_BYTES) return undefined;
      return fetchedRecord(id, JSON.parse(stdout));
    }
    const { apiUrl, headers } = pagespaceApi({
      token: env.PAGESPACE_TOKEN ?? '',
      apiUrl: env.PAGESPACE_API_URL ?? 'https://pagespace.ai',
    });
    const response = await (options.fetch ?? fetch)(
      new URL(`/api/pages/${id}`, apiUrl),
      {
        headers,
        redirect: 'error',
      },
    );
    if (!response.ok) return undefined;
    return fetchedRecord(id, await response.json());
  } catch {
    return undefined;
  }
}

/** Every id's record, and which ids could not be read at all. */
export async function readRecords(
  ids: readonly string[],
  options: RecordReadOptions = {},
): Promise<{
  readonly records: readonly RecordPage[];
  readonly unreadable: readonly string[];
}> {
  const read = await Promise.all(ids.map((id) => readRecord(id, options)));
  return {
    records: read.filter(
      (record): record is RecordPage => record !== undefined,
    ),
    unreadable: ids.filter((_, index) => read[index] === undefined),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const fullName = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.full_name === 'string'
    ? value.full_name
    : undefined;

function ciJob(job: unknown): CiJob | undefined {
  if (
    !isRecord(job) ||
    typeof job.name !== 'string' ||
    typeof job.status !== 'string' ||
    (job.conclusion !== null && typeof job.conclusion !== 'string')
  )
    return undefined;
  return { name: job.name, status: job.status, conclusion: job.conclusion };
}

/**
 * A workflow run and its latest jobs from the Actions API, or undefined
 * when either response is not the shape GitHub documents: a run the edge
 * cannot fully read never reaches the verifier.
 */
export function ciRunFromApi(
  id: string,
  run: unknown,
  jobPages: unknown,
): CiRun | undefined {
  const repository = isRecord(run) ? fullName(run.repository) : undefined;
  if (
    !isRecord(run) ||
    String(run.id) !== id ||
    repository === undefined ||
    typeof run.head_sha !== 'string' ||
    typeof run.event !== 'string' ||
    typeof run.path !== 'string' ||
    !Array.isArray(jobPages)
  )
    return undefined;
  const raw = jobPages.flatMap((page: unknown) =>
    isRecord(page) && Array.isArray(page.jobs) ? page.jobs : [undefined],
  );
  const jobs = raw.map(ciJob);
  if (jobs.some((job) => job === undefined)) return undefined;
  return {
    id,
    repository,
    headRepository: fullName(run.head_repository),
    headSha: run.head_sha,
    event: run.event,
    path: run.path,
    headBranch:
      typeof run.head_branch === 'string' ? run.head_branch : undefined,
    jobs: jobs.filter((job): job is CiJob => job !== undefined),
  };
}

/** Every item of every page gh api --paginate --slurp returned, or undefined. */
const slurped = (pages: unknown): readonly unknown[] | undefined =>
  Array.isArray(pages) && pages.every(Array.isArray) ? pages.flat() : undefined;

/**
 * Every PR ever opened from the head branch, and whether this PR's base
 * ever changed, from the pulls list and the PR timeline; undefined when
 * either is not the documented shape.
 */
export function pullRequestHistory(
  pulls: unknown,
  timeline: unknown,
): PullRequestHistory | undefined {
  const opened = slurped(pulls);
  const events = slurped(timeline);
  if (
    !opened?.every(
      (pull) => isRecord(pull) && typeof pull.number === 'number',
    ) ||
    !events?.every(isRecord)
  )
    return undefined;
  return {
    sameHead: opened.map((pull) => (pull as { number: number }).number),
    baseChanged: events.some((event) => event.event === 'base_ref_changed'),
  };
}

/**
 * Every cited run of this repository the API returns (the rest stay
 * unread), and the PR history CI evidence needs when any run is cited.
 */
export function readCiEvidence(
  run: Run,
  repository: string,
  ids: readonly string[],
  pr: PullRequest,
): CiEvidence {
  const api = (args: readonly string[]): unknown => {
    const result = run(args);
    if (result.code !== 0) throw new Error('CI run unavailable');
    return JSON.parse(result.stdout);
  };
  const pages = (path: string) => api(['api', '--paginate', '--slurp', path]);
  const owner = repository.split('/')[0];
  const readHistory = (): PullRequestHistory | undefined => {
    try {
      return ids.length === 0 || !pr.headRef
        ? undefined
        : pullRequestHistory(
            pages(
              `repos/${repository}/pulls?head=${encodeURIComponent(`${owner}:${pr.headRef}`)}&state=all&per_page=100`,
            ),
            pages(
              `repos/${repository}/issues/${pr.number}/timeline?per_page=100`,
            ),
          );
    } catch {
      return undefined;
    }
  };
  const runs = ids.flatMap((id) => {
    if (!/^\d+$/.test(id)) return [];
    try {
      const read = ciRunFromApi(
        id,
        api(['api', `repos/${repository}/actions/runs/${id}`]),
        // filter=latest: a re-run's jobs replace the attempt before it.
        api([
          'api',
          '--paginate',
          '--slurp',
          `repos/${repository}/actions/runs/${id}/jobs?filter=latest&per_page=100`,
        ]),
      );
      return read ? [read] : [];
    } catch {
      return [];
    }
  });
  return { repository, runs, history: readHistory() };
}
