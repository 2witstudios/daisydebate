#!/usr/bin/env bun
/**
 * The committed spawn wrapper (ADR 0035).
 *
 *   bun agent:spawn [--task <leaf>] [--role builder|reviewer] [--cap N]
 *     [--override] -- -n <name> [-b <base>] [-a <agent>] … "<prompt>"
 *   bun agent:send <agent> "<text>"
 *
 * Before a builder starts it refuses superseded terms in the leaf, undeclared
 * or unmerged prerequisites and a full builder cap (the owner may override).
 * It creates the worktree, installs dependencies and brings the PAR-2 slot
 * up before any prompt is sent, resolves the child id from `pu status
 * --json`, registers its parent and role in the main checkout's agent
 * registry, outside the child's reach (agent-registry.ts), and confirms the prompt
 * reached the transcript, nudging with an empty `pu send` when it did not.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  activeAfterSend,
  activeBuilders,
  findPrerequisites,
  parseSpawnArgs,
  prerequisiteBlockers,
  supersededTerms,
  agentCwd,
  projectDir,
  userTurnsWith,
  type SpawnPlan,
  type SupersededTerm,
} from './agent-spawn-model';
import { parseRecord, recordPath, serializeRecord } from './agent-registry';

type Result = { readonly code: number; readonly stdout: string };

export type SpawnDeps = {
  readonly run: (args: readonly string[], cwd?: string) => Result;
  readonly read: (path: string) => string | undefined;
  readonly write: (path: string, text: string) => void;
  readonly sleep: (ms: number) => Promise<void>;
  /** Seconds the agent's terminal has been silent (`pu pulse`), if known. */
  readonly idleOf: (agentId: string) => number | null;
  /** Transcript files (.jsonl) in a Claude Code projects directory. */
  readonly list: (dir: string) => readonly string[];
  readonly home: string;
  readonly mainCheckout: string;
  readonly repoRoot: string;
  readonly parentId: string | undefined;
  readonly autonomous: boolean;
  readonly out: (text: string) => void;
};

type Agent = {
  readonly id: string;
  readonly agentType?: string;
  readonly status?: string;
};
type Worktree = {
  readonly id: string;
  readonly path: string;
  readonly branch: string;
  readonly agents?: Readonly<Record<string, Agent>>;
};
type Status = {
  readonly worktrees?: readonly Worktree[];
  readonly agents?: readonly { readonly id: string }[];
};

class SpawnRefused extends Error {}

const SETUP: readonly (readonly string[])[] = [
  ['bun', 'install', '--frozen-lockfile'],
  ['bun', 'slot:up'],
];
const POLL_MS = 1_000;
const POLLS = 15;

function puStatus(deps: SpawnDeps): Status {
  const result = deps.run(['pu', 'status', '--json']);
  if (result.code !== 0) throw new SpawnRefused('pu status failed');
  return JSON.parse(result.stdout) as Status;
}

const pageJson = <T>(deps: SpawnDeps, args: readonly string[]): T => {
  const result = deps.run(['pagespace', ...args, '--json']);
  if (result.code !== 0)
    throw new SpawnRefused(`pagespace ${args.join(' ')} failed`);
  return JSON.parse(result.stdout) as T;
};

function leafStatus(deps: SpawnDeps, pageId: string): string | undefined {
  const { parentId } = pageJson<{ parentId: string | null }>(deps, [
    'pages',
    'read-details',
    pageId,
  ]);
  if (!parentId) return undefined;
  return pageJson<{ tasks: { pageId: string; status: string }[] }>(deps, [
    'tasks',
    'list',
    parentId,
  ]).tasks.find((task) => task.pageId === pageId)?.status;
}

/** Every reason a builder for this leaf must not start yet. */
function checkLeaf(deps: SpawnDeps, plan: SpawnPlan): readonly string[] {
  if (!plan.task) return [];
  const content =
    pageJson<{ content?: string }>(deps, ['pages', 'read', plan.task])
      .content ?? '';
  const table = JSON.parse(
    deps.read(join(deps.repoRoot, 'policy/superseded-terms.json')) ?? '[]',
  ) as SupersededTerm[];
  const terms = supersededTerms(content, table);
  if (plan.role !== 'builder') return terms;
  return [
    ...terms,
    ...prerequisiteBlockers(findPrerequisites(content), {
      prMerged: (pr) =>
        deps
          .run([
            'gh',
            'pr',
            'view',
            String(pr),
            '--json',
            'state',
            '--jq',
            '.state',
          ])
          .stdout.trim() === 'MERGED',
      adrMerged: (adr) =>
        deps
          .run([
            'git',
            'ls-tree',
            '--name-only',
            'origin/main',
            'docs/decisions/',
          ])
          .stdout.split('\n')
          .some((file) => file.startsWith(`docs/decisions/${adr}-`)),
      leafStatus: (pageId) => leafStatus(deps, pageId),
    }),
  ];
}

function checkCap(deps: SpawnDeps, plan: SpawnPlan): readonly string[] {
  if (plan.role !== 'builder') return [];
  const active = activeBuilders(puStatus(deps), (agentId) => {
    const text = deps.read(recordPath(deps.mainCheckout, agentId));
    return text === undefined ? undefined : parseRecord(text)?.role;
  });
  return active >= plan.cap
    ? [`${active} builders are active; the cap is ${plan.cap}`]
    : [];
}

function newWorktree(before: Status, after: Status, branch: string) {
  const known = new Set((before.worktrees ?? []).map((w) => w.id));
  return (after.worktrees ?? []).find(
    (worktree) => !known.has(worktree.id) && worktree.branch === branch,
  );
}

function newAgent(before: Status, after: Status, worktreeId: string) {
  const known = new Set(
    (before.worktrees ?? []).flatMap((w) => Object.keys(w.agents ?? {})),
  );
  const worktree = after.worktrees?.find((w) => w.id === worktreeId);
  return Object.values(worktree?.agents ?? {}).find(
    (agent) => !known.has(agent.id) && agent.agentType !== 'terminal',
  );
}

function turnsWith(deps: SpawnDeps, cwd: string, text: string): number {
  return deps
    .list(projectDir(deps.home, cwd))
    .reduce((sum, file) => sum + userTurnsWith(deps.read(file) ?? '', text), 0);
}

/**
 * Polls until the text shows as a new user turn in the agent's transcripts
 * or the agent is visibly working (activeAfterSend).
 */
async function tookText(
  deps: SpawnDeps,
  agentId: string,
  grew: () => boolean,
): Promise<boolean> {
  const samples: { at: number; idle: number | null }[] = [];
  for (let poll = 0; poll < POLLS; poll += 1) {
    samples.push({ at: (poll * POLL_MS) / 1000, idle: deps.idleOf(agentId) });
    if (grew() || activeAfterSend(samples)) return true;
    await deps.sleep(POLL_MS);
  }
  return false;
}

/**
 * Confirms the text was submitted, nudging once with an empty pu send (pu
 * often leaves text typed but unsubmitted) when it was not.
 */
async function confirmSubmitted(
  deps: SpawnDeps,
  agentId: string,
  cwd: string,
  text: string,
  before: number,
): Promise<boolean> {
  const grew = () => turnsWith(deps, cwd, text) > before;
  if (await tookText(deps, agentId, grew)) return true;
  deps.out(`${agentId}: text not submitted; nudging with an empty pu send\n`);
  deps.run(['pu', 'send', agentId, '']);
  return tookText(deps, agentId, grew);
}

const PU_VALUE_FLAGS = new Set([
  '--file',
  '--template',
  '--var',
  '--command',
  '--trigger',
]);

/** The prompt text a pu spawn sends, when it can be known. */
function promptText(deps: SpawnDeps, rest: readonly string[]) {
  let text: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--file') text = deps.read(rest[index + 1] ?? '');
    if (PU_VALUE_FLAGS.has(rest[index])) index += 1;
    else if (!rest[index].startsWith('-')) text = rest[index];
  }
  return text?.trim() || undefined;
}

function setUp(deps: SpawnDeps, worktree: Worktree) {
  for (const step of SETUP) {
    deps.out(`${worktree.path}: ${step.join(' ')}\n`);
    if (deps.run(step, worktree.path).code !== 0)
      throw new SpawnRefused(
        `${step.join(' ')} failed in ${worktree.path}; no prompt was sent`,
      );
  }
}

async function spawnChecked(deps: SpawnDeps, plan: SpawnPlan): Promise<number> {
  const blockers = [...checkLeaf(deps, plan), ...checkCap(deps, plan)];
  if (blockers.length > 0 && (!plan.override || deps.autonomous))
    throw new SpawnRefused(
      `Refusing to spawn:\n- ${blockers.join('\n- ')}\n${deps.autonomous ? 'Only the owner can override.' : 'Pass --override to spawn anyway.'}`,
    );
  const before = puStatus(deps);
  deps.run([
    'pu',
    'spawn',
    '-a',
    'terminal',
    '-n',
    plan.name,
    '-b',
    plan.base,
    '--command',
    'true',
  ]);
  const worktree = newWorktree(before, puStatus(deps), `pu/${plan.name}`);
  if (!worktree) throw new SpawnRefused(`pu did not create pu/${plan.name}`);
  setUp(deps, worktree);
  const ready = puStatus(deps);
  deps.run(['pu', 'spawn', '-w', worktree.id, '-a', plan.agent, ...plan.rest]);
  const agent = newAgent(ready, puStatus(deps), worktree.id);
  if (!agent) throw new SpawnRefused('pu status shows no new agent');
  deps.write(
    recordPath(deps.mainCheckout, agent.id),
    serializeRecord({
      parent: deps.parentId ?? null,
      role: plan.role,
      worktree: worktree.path,
    }),
  );
  deps.out(
    `spawned ${agent.id} in ${worktree.path} (parent ${deps.parentId ?? 'owner'})\n`,
  );
  const prompt = promptText(deps, plan.rest);
  if (plan.agent !== 'claude' || !prompt) return 0;
  const submitted = await confirmSubmitted(
    deps,
    agent.id,
    worktree.path,
    prompt,
    0,
  );
  deps.out(
    `${agent.id}: prompt ${submitted ? 'submitted' : 'NOT confirmed; check pu logs'}\n`,
  );
  return submitted ? 0 : 1;
}

export async function spawnAgent(
  deps: SpawnDeps,
  argv: readonly string[],
): Promise<number> {
  const plan = parseSpawnArgs(argv);
  if ('error' in plan) {
    deps.out(`${plan.error}\n`);
    return 2;
  }
  try {
    return await spawnChecked(deps, plan);
  } catch (error) {
    if (!(error instanceof SpawnRefused)) throw error;
    deps.out(`${error.message}\n`);
    return 1;
  }
}

/** `bun agent:send`: pu send that confirms the text was submitted. */
export async function sendConfirmed(
  deps: SpawnDeps,
  agentId: string,
  text: string,
): Promise<number> {
  const cwd = agentCwd(puStatus(deps), agentId, deps.mainCheckout);
  if (!cwd || text.trim() === '') {
    deps.out(
      cwd
        ? 'usage: bun agent:send <agent> "<text>"\n'
        : `pu status does not list ${agentId}\n`,
    );
    return cwd ? 2 : 1;
  }
  const before = turnsWith(deps, cwd, text);
  if (deps.run(['pu', 'send', agentId, text]).code !== 0) return 1;
  const submitted = await confirmSubmitted(deps, agentId, cwd, text, before);
  deps.out(
    `${agentId}: ${submitted ? 'submitted' : 'NOT confirmed; check pu logs'}\n`,
  );
  return submitted ? 0 : 1;
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dir, '..');
  const deps: SpawnDeps = {
    run: (args, cwd) => {
      const result = Bun.spawnSync([...args], {
        cwd: cwd ?? repoRoot,
        stdout: 'pipe',
        stderr: 'inherit',
      });
      return { code: result.exitCode, stdout: result.stdout.toString() };
    },
    read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
    write: (path, text) => {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, text);
    },
    sleep: (ms) => Bun.sleep(ms),
    idleOf: (agentId) => {
      const pulse = JSON.parse(
        Bun.spawnSync(['pu', 'pulse', '--json'], {
          stdout: 'pipe',
        }).stdout.toString() || '{}',
      ) as {
        worktrees?: { agents: { id: string; idle_seconds: number | null }[] }[];
        root_agents?: { id: string; idle_seconds: number | null }[];
      };
      const agents = [
        ...(pulse.worktrees ?? []).flatMap((w) => w.agents),
        ...(pulse.root_agents ?? []),
      ];
      return agents.find((agent) => agent.id === agentId)?.idle_seconds ?? null;
    },
    list: (dir) =>
      existsSync(dir)
        ? readdirSync(dir)
            .filter((name) => name.endsWith('.jsonl'))
            .map((name) => join(dir, name))
        : [],
    home: homedir(),
    mainCheckout: dirname(
      Bun.spawnSync(
        ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: repoRoot, stdout: 'pipe' },
      )
        .stdout.toString()
        .trim(),
    ),
    repoRoot,
    parentId: process.env.PU_AGENT_ID || undefined,
    autonomous: process.env.DAISY_AUTONOMOUS === '1',
    out: (text) => process.stdout.write(text),
  };
  const [mode, ...args] = process.argv.slice(2);
  process.exitCode =
    mode === 'send'
      ? await sendConfirmed(deps, args[0] ?? '', args.slice(1).join(' '))
      : await spawnAgent(deps, args);
}
