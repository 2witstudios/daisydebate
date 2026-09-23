/**
 * Pure model of local database slots (ADR 0034). One shared Postgres and
 * Redis serve every checkout; each checkout owns the databases and Redis
 * namespaces derived here from its folder, never chosen by hand. The
 * effectful CLI lives in slot.ts.
 */
import { basename } from 'node:path';

export type Slot = {
  readonly kind: 'main' | 'worktree';
  readonly id: string;
  readonly database: string;
  readonly testDatabase: string;
  readonly namespace: string;
  readonly e2eNamespace: string;
};

type Env = Readonly<Record<string, string | undefined>>;

const prefix = 'daisy';
const worktreeDatabasePrefix = `${prefix}_wt_`;
const worktreeNamespacePrefix = `${prefix}-wt-`;
// `daisy-wt-<id>-e2e` must fit REDIS_NAMESPACE (^[a-z][a-z0-9-]{0,40}$).
const maxIdLength = 41 - worktreeNamespacePrefix.length - '-e2e'.length;
// Lowercase words joined by single underscores. The `_test` and `_e2e`
// suffixes are reserved so every database and namespace name maps back to
// exactly one slot.
const slotIdPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const reservedSuffix = /_(?:test|e2e)$/;

export const e2eRole = { user: 'daisy_e2e', password: 'e2e-loopback-only' };
const e2eRedisDatabase = 2;
const mainPorts = { app: 3000, e2e: 3100 };
// Worktree block n owns app port 13000+10n and e2e ports 13001+10n..+3.
const portBlockBase = 13_000;
const portBlockSize = 10;
const maxPortBlock = 499;

const isSlotId = (id: string): boolean =>
  id.length <= maxIdLength &&
  slotIdPattern.test(id) &&
  !reservedSuffix.test(id);

export function worktreeSlot(id: string): Slot {
  if (!isSlotId(id)) throw new Error(`Invalid slot id "${id}"`);
  const hyphenated = id.replaceAll('_', '-');
  return {
    kind: 'worktree',
    id,
    database: `${worktreeDatabasePrefix}${id}`,
    testDatabase: `${worktreeDatabasePrefix}${id}_test`,
    namespace: `${worktreeNamespacePrefix}${hyphenated}`,
    e2eNamespace: `${worktreeNamespacePrefix}${hyphenated}-e2e`,
  };
}

const mainSlot: Slot = {
  kind: 'main',
  id: prefix,
  database: prefix,
  testDatabase: `${prefix}_test`,
  namespace: prefix,
  e2eNamespace: `${prefix}-e2e`,
};

/** `wt-3ctbm0tw` → `3ctbm0tw`; `Feature-Login` → `feature_login`. */
function slotIdFromFolder(folder: string): string {
  const id = folder
    .toLowerCase()
    .replace(/^wt[-_]/, '')
    .replaceAll('-', '_');
  if (!isSlotId(id))
    throw new Error(
      `Cannot derive a slot from worktree folder "${folder}": use letters, digits and single hyphens, at most ${maxIdLength} characters, not ending in -test or -e2e`,
    );
  return id;
}

/** Paths must already be resolved to real paths by the caller. */
export function deriveSlot({
  checkout,
  mainCheckout,
}: {
  readonly checkout: string;
  readonly mainCheckout: string;
}): Slot {
  return checkout === mainCheckout
    ? mainSlot
    : worktreeSlot(slotIdFromFolder(basename(checkout)));
}

/** Parses `git worktree list --porcelain`; prunable entries are gone. */
export function parseWorktreeList(porcelain: string): {
  readonly main: string;
  readonly worktrees: readonly string[];
} {
  const entries = porcelain
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').filter(Boolean))
    .filter((lines) => lines[0]?.startsWith('worktree '))
    .map((lines) => ({
      path: (lines[0] ?? '').slice('worktree '.length),
      prunable: lines.some((line) => line.startsWith('prunable')),
    }));
  const [first, ...rest] = entries;
  if (!first) throw new Error('git worktree list returned no main checkout');
  return {
    main: first.path,
    worktrees: rest.filter((entry) => !entry.prunable).map(({ path }) => path),
  };
}

export function liveWorktreeIds(paths: readonly string[]): {
  readonly ids: readonly string[];
  readonly unslotted: readonly string[];
} {
  const owners = new Map<string, string>();
  const unslotted: string[] = [];
  for (const path of paths) {
    let id: string;
    try {
      id = slotIdFromFolder(basename(path));
    } catch {
      unslotted.push(path);
      continue;
    }
    const owner = owners.get(id);
    if (owner)
      throw new Error(
        `Worktrees ${owner} and ${path} derive the same slot "${id}"; rename one folder`,
      );
    owners.set(id, path);
  }
  return { ids: [...owners.keys()], unslotted };
}

const idOfDatabase = (name: string): string | undefined => {
  if (!name.startsWith(worktreeDatabasePrefix)) return undefined;
  const id = name.slice(worktreeDatabasePrefix.length).replace(/_test$/, '');
  return isSlotId(id) ? id : undefined;
};

const idOfNamespace = (namespace: string): string | undefined => {
  if (!namespace.startsWith(worktreeNamespacePrefix)) return undefined;
  const id = namespace
    .slice(worktreeNamespacePrefix.length)
    .replace(/-e2e$/, '')
    .replaceAll('-', '_');
  return isSlotId(id) ? id : undefined;
};

/**
 * Worktree slots whose worktree is gone. Names that do not parse as a
 * worktree slot (main, the template, foreign databases) are never selected.
 */
export function findOrphans({
  liveIds,
  databases,
  namespaces,
}: {
  readonly liveIds: readonly string[];
  readonly databases: readonly string[];
  readonly namespaces: readonly string[];
}) {
  const live = new Set(liveIds);
  const orphaned = (id: string | undefined): id is string =>
    id !== undefined && !live.has(id);
  const orphanDatabases = databases.filter((name) =>
    orphaned(idOfDatabase(name)),
  );
  const orphanNamespaces = namespaces.filter((name) =>
    orphaned(idOfNamespace(name)),
  );
  const ids = new Set([
    ...orphanDatabases.map(idOfDatabase),
    ...orphanNamespaces.map(idOfNamespace),
  ]);
  return {
    ids: [...ids].filter((id): id is string => id !== undefined).sort(),
    databases: [...orphanDatabases].sort(),
    namespaces: [...orphanNamespaces].sort(),
  };
}

const databaseName = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    return undefined;
  }
};

const serverOf = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
};

/** Every .env value that names a slot or server other than this checkout's. */
export function slotMismatches(slot: Slot, env: Env): readonly string[] {
  const checks: readonly (readonly [string, string | undefined, string])[] = [
    ['DATABASE_URL', databaseName(env.DATABASE_URL), slot.database],
    [
      'TEST_DATABASE_URL',
      databaseName(env.TEST_DATABASE_URL),
      slot.testDatabase,
    ],
    ['E2E_DATABASE_URL', databaseName(env.E2E_DATABASE_URL), slot.testDatabase],
    ['REDIS_NAMESPACE', env.REDIS_NAMESPACE, slot.namespace],
    ['E2E_REDIS_NAMESPACE', env.E2E_REDIS_NAMESPACE, slot.e2eNamespace],
  ];
  const names = checks
    .filter(([, actual, expected]) => actual !== expected)
    .map(([key, actual, expected]) =>
      actual === undefined
        ? `${key} is unset, expected "${expected}"`
        : `${key} names "${actual}", expected "${expected}"`,
    );
  const server = serverOf(env.DATABASE_URL);
  const servers = (['TEST_DATABASE_URL', 'E2E_DATABASE_URL'] as const)
    .map((key) => [key, serverOf(env[key])] as const)
    .filter(
      ([, actual]) =>
        server !== undefined && actual !== undefined && actual !== server,
    )
    .map(
      ([key, actual]) =>
        `${key} is on ${actual}, expected the DATABASE_URL server ${server}`,
    );
  return [...names, ...servers];
}

const withPath = (
  url: string,
  path: string,
  credentials?: typeof e2eRole,
): string => {
  const next = new URL(url);
  next.pathname = `/${path}`;
  if (credentials) {
    next.username = credentials.user;
    next.password = credentials.password;
  }
  return next.toString();
};

const requireEnv = (env: Env, key: string): string => {
  const value = env[key];
  if (!value) throw new Error(`${key} is required in .env`);
  return value;
};

/**
 * The slot's .env values. The server (host, port, credentials) comes from
 * the existing URLs, which is how the admin connection is injected.
 */
export function slotEnvValues({
  slot,
  env,
  portBlock,
}: {
  readonly slot: Slot;
  readonly env: Env;
  readonly portBlock?: number;
}): Readonly<Record<string, string>> {
  const databaseUrl = requireEnv(env, 'DATABASE_URL');
  const redisUrl = requireEnv(env, 'REDIS_URL');
  const ports =
    slot.kind === 'main'
      ? mainPorts
      : (() => {
          if (portBlock === undefined)
            throw new Error('A worktree slot needs a port block');
          const app = portBlockBase + portBlockSize * portBlock;
          return { app, e2e: app + 1 };
        })();
  return {
    DATABASE_URL: withPath(databaseUrl, slot.database),
    // Every slot URL shares DATABASE_URL's server, so a stale test URL left
    // on an old per-session server cannot split the slot across two stacks.
    TEST_DATABASE_URL: withPath(databaseUrl, slot.testDatabase),
    REDIS_NAMESPACE: slot.namespace,
    E2E_DATABASE_URL: withPath(databaseUrl, slot.testDatabase, e2eRole),
    E2E_REDIS_URL: e2eRedisUrl(redisUrl),
    E2E_REDIS_NAMESPACE: slot.e2eNamespace,
    PORT: String(ports.app),
    PUBLIC_APP_URL: `http://localhost:${ports.app}`,
    E2E_PORT: String(ports.e2e),
  };
}

/** The Redis database the browser suite's server uses, beside the dev one. */
export const e2eRedisUrl = (redisUrl: string): string =>
  withPath(redisUrl, String(e2eRedisDatabase));

/** Every port a worktree block reserves: the app and the three e2e ports. */
export const portBlockPorts = (block: number): readonly number[] => {
  const app = portBlockBase + portBlockSize * block;
  return [app, app + 1, app + 2, app + 3];
};

const assignment = (key: string) => new RegExp(`^${key}=(.*)$`, 'gm');

export function readEnvValue(content: string, key: string): string | undefined {
  return [...content.matchAll(assignment(key))].at(-1)?.[1];
}

/** Rewrites every canonical `KEY=` line; appends keys the file lacks. */
export function rewriteEnv(
  content: string,
  values: Readonly<Record<string, string>>,
): { readonly content: string; readonly changed: boolean } {
  let next = content;
  for (const [key, value] of Object.entries(values)) {
    if (readEnvValue(next, key) === undefined)
      next = `${next}${next && !next.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
    else next = next.replace(assignment(key), () => `${key}=${value}`);
  }
  return { content: next, changed: next !== content };
}

const portBlockClaim = /^daisy-slot port-block=([1-9][0-9]{0,2})$/;

/** The claim stored as the slot database's comment (shared, self-cleaning). */
export function portBlockComment(block: number): string {
  if (!Number.isInteger(block) || block < 1 || block > maxPortBlock)
    throw new Error(`Invalid port block ${block}`);
  return `daisy-slot port-block=${block}`;
}

export function parsePortBlockComment(
  comment: string | null | undefined,
): number | undefined {
  const match = portBlockClaim.exec(comment ?? '');
  const block = match ? Number(match[1]) : undefined;
  return block !== undefined && block <= maxPortBlock ? block : undefined;
}

export function pickPortBlock({
  own,
  claimed,
  isFree,
}: {
  readonly own?: number;
  readonly claimed: readonly number[];
  readonly isFree: (block: number) => boolean;
}): number {
  if (own !== undefined) return own;
  const taken = new Set(claimed);
  for (let block = 1; block <= maxPortBlock; block += 1)
    if (!taken.has(block) && isFree(block)) return block;
  throw new Error('No free port block left for a new slot');
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Why slot administration must refuse these service URLs, or undefined.
 * Slot tooling force-drops databases and unlinks namespaces, so it only
 * ever talks to the local shared stack, never a stale or remote server.
 */
export function serviceRefusal(env: Env): string | undefined {
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'E2E_REDIS_URL'] as const) {
    const value = env[key];
    if (value === undefined) {
      if (key === 'E2E_REDIS_URL') continue;
      return `${key} is required in .env`;
    }
    let host: string;
    try {
      host = new URL(value).hostname;
    } catch {
      return `${key} is not a valid URL`;
    }
    if (!loopbackHosts.has(host))
      return `${key} must name the local stack (localhost, 127.0.0.1 or ::1), not ${host}`;
  }
  return undefined;
}

/** Why `bun db:reset` must refuse this target, or undefined to proceed. */
export function resetRefusal(slot: Slot, env: Env): string | undefined {
  if (env.NODE_ENV === 'production') return 'Reset never runs in production';
  if (env.ALLOW_DATABASE_RESET !== 'yes')
    return 'Reset requires ALLOW_DATABASE_RESET=yes';
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? '');
  } catch {
    return 'Reset requires a DATABASE_URL';
  }
  if (!loopbackHosts.has(url.hostname))
    return 'Reset requires a loopback DATABASE_URL';
  const name = databaseName(url.toString());
  if (name !== slot.database && name !== slot.testDatabase)
    return `Reset accepts only this checkout's databases (${slot.database}, ${slot.testDatabase})`;
  return undefined;
}
