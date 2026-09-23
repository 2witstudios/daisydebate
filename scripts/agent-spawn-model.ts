/**
 * Pure decisions of the spawn wrapper (agent-spawn.ts, ADR 0035): argument
 * handling, the active-builder cap, declared prerequisites, terms a merged
 * ADR superseded, and whether a prompt reached the agent's transcript.
 */

export type Role = 'builder' | 'reviewer';

export type SpawnPlan = {
  readonly task: string | undefined;
  readonly role: Role;
  readonly override: boolean;
  readonly cap: number;
  readonly name: string;
  readonly base: string;
  readonly agent: string;
  /** pu spawn arguments for the agent itself (prompt, --file, …). */
  readonly rest: readonly string[];
};

const SPAWN_USAGE =
  'usage: bun agent:spawn [--task <leafPageId>] [--role builder|reviewer] [--cap N] [--override] -- -n <name> [-b <base>] [-a <agent>] [pu spawn options] "<prompt>"';

const DEFAULT_CAP = 3;

function wrapperOptions(args: readonly string[]) {
  const options = {
    task: undefined as string | undefined,
    role: 'builder',
    override: false,
    cap: DEFAULT_CAP,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--override') options.override = true;
    else if (arg === '--task') options.task = args[++index];
    else if (arg === '--role') options.role = args[++index] ?? '';
    else if (arg === '--cap') options.cap = Number(args[++index]);
  }
  return options;
}

/**
 * What an autonomous agent may not choose for itself: the cap, the role
 * (a reviewer is not counted) and a builder with no leaf to check.
 */
function autonomyError(
  args: readonly string[],
  options: ReturnType<typeof wrapperOptions>,
) {
  const owned = ['--cap', '--role'].find((flag) => args.includes(flag));
  if (owned) return `Only the owner can pass ${owned}.`;
  return options.task
    ? undefined
    : 'An autonomous agent spawns a builder only for a leaf: pass --task <leafPageId>.';
}

function optionsError(
  options: ReturnType<typeof wrapperOptions>,
  name: string | undefined,
) {
  if (!name) return '--name is required';
  if (options.role !== 'builder' && options.role !== 'reviewer')
    return '--role must be builder or reviewer';
  if (!Number.isInteger(options.cap) || options.cap < 1)
    return '--cap must be a positive integer';
  return undefined;
}

const puValueFlags: Readonly<Record<string, 'name' | 'base' | 'agent'>> = {
  '-n': 'name',
  '--name': 'name',
  '-b': 'base',
  '--base': 'base',
  '-a': 'agent',
  '--agent': 'agent',
};

export function parseSpawnArgs(
  argv: readonly string[],
  autonomous = false,
): SpawnPlan | { readonly error: string } {
  const split = argv.indexOf('--');
  const wrapper = split === -1 ? [] : argv.slice(0, split);
  const options = wrapperOptions(wrapper);
  const refused = autonomous ? autonomyError(wrapper, options) : undefined;
  if (refused) return { error: `${refused}\n${SPAWN_USAGE}` };
  const spawn = split === -1 ? argv : argv.slice(split + 1);
  const picked: Record<'name' | 'base' | 'agent', string | undefined> = {
    name: undefined,
    base: 'main',
    agent: 'claude',
  };
  const rest: string[] = [];
  for (let index = 0; index < spawn.length; index += 1) {
    const key = puValueFlags[spawn[index]];
    if (key) picked[key] = spawn[++index];
    // pu needs --agent-args in its = form; a separate word is lost.
    else if (spawn[index] === '--agent-args')
      rest.push(`--agent-args=${spawn[++index] ?? ''}`);
    else rest.push(spawn[index]);
  }
  const invalid = optionsError(options, picked.name);
  if (invalid) return { error: `${invalid}\n${SPAWN_USAGE}` };
  return {
    ...options,
    role: options.role as Role,
    name: picked.name ?? '',
    base: picked.base ?? 'main',
    agent: picked.agent ?? 'claude',
    rest,
  };
}

type PuStatus = {
  readonly worktrees?: readonly {
    readonly path: string;
    readonly agents?: Readonly<
      Record<string, { readonly status?: string; readonly agentType?: string }>
    >;
  }[];
};

/**
 * Running coding agents that count toward the builder cap: every one not
 * registered as a reviewer, so an agent from a raw pu spawn counts too.
 */
export function activeBuilders(
  status: PuStatus,
  roleOf: (agentId: string) => Role | undefined,
): number {
  return (status.worktrees ?? [])
    .flatMap((worktree) => Object.entries(worktree.agents ?? {}))
    .filter(
      ([id, agent]) =>
        roleOf(id) !== 'reviewer' &&
        agent.status === 'running' &&
        agent.agentType !== 'terminal',
    ).length;
}

export type Prerequisites = {
  readonly leaves: readonly string[];
  readonly prs: readonly number[];
  readonly adrs: readonly string[];
};

/** Prerequisites declared on `Prerequisite:` lines of Related pages. */
export function findPrerequisites(html: string): Prerequisites {
  const related = html.slice(html.lastIndexOf('Related pages'));
  const lines = related
    .split(/<\/li>/)
    .filter((item) => /Prerequisite\s*:/i.test(item));
  const all = (pattern: RegExp) =>
    lines.flatMap((line) => [...line.matchAll(pattern)].map((m) => m[1]));
  return {
    leaves: all(/data-page-id="([a-z0-9]+)"/g),
    prs: all(/PR #(\d+)/g).map(Number),
    adrs: all(/ADR[ -](\d{4})/g),
  };
}

const MERGED_STATUSES = new Set(['merged', 'completed']);

export function prerequisiteBlockers(
  prerequisites: Prerequisites,
  facts: {
    readonly prMerged: (pr: number) => boolean;
    readonly adrMerged: (adr: string) => boolean;
    readonly leafStatus: (pageId: string) => string | undefined;
  },
): readonly string[] {
  return [
    ...prerequisites.leaves.flatMap((leaf) => {
      const status = facts.leafStatus(leaf);
      return status !== undefined && MERGED_STATUSES.has(status)
        ? []
        : [`leaf ${leaf} is ${status ?? 'unknown'}, not merged`];
    }),
    ...prerequisites.prs
      .filter((pr) => !facts.prMerged(pr))
      .map((pr) => `PR #${pr} is not merged`),
    ...prerequisites.adrs
      .filter((adr) => !facts.adrMerged(adr))
      .map((adr) => `ADR ${adr} is not on origin/main`),
  ];
}

export type SupersededTerm = {
  readonly pattern: string;
  readonly term: string;
  readonly adr: string;
  readonly use: string;
};

export function supersededTerms(
  text: string,
  table: readonly SupersededTerm[],
): readonly string[] {
  return table.flatMap((entry) =>
    [...new Set(text.match(new RegExp(entry.pattern, 'gi')) ?? [])].map(
      (found) =>
        `"${found}" was superseded by ADR ${entry.adr}: use ${entry.use}`,
    ),
  );
}

/** Where Claude Code keeps the transcripts of sessions started in cwd. */
export const projectDir = (home: string, cwd: string): string =>
  `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`;

const userText = (entry: {
  readonly message?: { readonly content?: unknown };
}): string => {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content
        .map((part) => (part as { text?: unknown }).text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n')
    : '';
};

/**
 * User turns in a transcript that carry the text. A session can continue
 * under a new id, so submission is confirmed by content across the agent's
 * transcripts rather than by one session file.
 */
export function userTurnsWith(transcript: string, text: string): number {
  const needle = text.trim().slice(0, 80);
  return transcript.split('\n').filter((line) => {
    try {
      const entry = JSON.parse(line) as { type?: string };
      return entry.type === 'user' && userText(entry).includes(needle);
    } catch {
      return false;
    }
  }).length;
}

type StatusAgents = {
  readonly worktrees?: readonly {
    readonly path: string;
    readonly agents?: Readonly<Record<string, unknown>>;
  }[];
  readonly agents?: readonly { readonly id: string }[];
};

/** The working directory of an agent: its worktree, or the main checkout. */
export function agentCwd(
  status: StatusAgents,
  agentId: string,
  mainCheckout: string,
): string | undefined {
  const worktree = status.worktrees?.find((w) =>
    Object.hasOwn(w.agents ?? {}, agentId),
  );
  if (worktree) return worktree.path;
  return status.agents?.some((agent) => agent.id === agentId)
    ? mainCheckout
    : undefined;
}

/** Seconds since the send, and the agent's idle seconds from `pu pulse`. */
type IdleSample = { readonly at: number; readonly idle: number | null };

/**
 * pu reports how long an agent's terminal has been silent. Text left
 * unsubmitted produces only its echo, while a working session keeps
 * writing, so output 3 s or more after the send means the text was taken.
 */
export const activeAfterSend = (samples: readonly IdleSample[]): boolean =>
  samples.some(
    (sample) => sample.at >= 3 && sample.idle !== null && sample.idle <= 1,
  );
