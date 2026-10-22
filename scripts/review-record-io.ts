/**
 * The Daisy Debate drive and the shared low-level I/O for the review-record
 * check: reading a linked record page from PageSpace, and a PR's live head
 * SHA, body and comments through gh. review-record.ts's pure
 * verifier and its self-check command (`bun review:check`, ISSUE-122) both
 * read through this module, so there is exactly one copy of each call.
 */
import { execFileSync } from 'node:child_process';
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

export const gh: Run = (args) => {
  const result = Bun.spawnSync(['gh', ...args], {
    stdout: 'pipe',
    stderr: 'inherit',
  });
  return { code: result.exitCode, stdout: result.stdout.toString() };
};

export function ghJson<T>(args: readonly string[]): T {
  const result = gh(args);
  if (result.code !== 0) throw new Error(`gh ${args[1]} failed`);
  return JSON.parse(result.stdout) as T;
}

type PrDiffSource = {
  readonly head: { readonly sha: string };
  readonly base: { readonly sha: string };
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
    pr: {
      number: prNumber,
      headSha: pull.head.sha,
      body: pull.body ?? '',
      diff: readPullRequestDiff(gh, repository, pull),
    },
    comments,
  };
}

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
