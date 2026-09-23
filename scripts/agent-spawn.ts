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
 * up before any prompt is sent, records the parent agent in `.daisy/parent`,
 * resolves the child id from `pu status --json`, and confirms the prompt
 * reached the transcript, nudging with an empty `pu send` when it did not.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  activeBuilders,
  findPrerequisites,
  parseSpawnArgs,
  prerequisiteBlockers,
  supersededTerms,
  transcriptPath,
  userTurns,
  type Role,
  type SpawnPlan,
  type SupersededTerm,
} from './agent-spawn-model';

type Result = { readonly code: number; readonly stdout: string };

export type SpawnDeps = {
  readonly run: (args: readonly string[], cwd?: string) => Result;
  readonly read: (path: string) => string | undefined;
  readonly write: (path: string, text: string) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly home: string;
  readonly repoRoot: string;
  readonly parentId: string | undefined;
  readonly autonomous: boolean;
  readonly out: (text: string) => void;
};

type Agent = {
  readonly id: string;
  readonly agentType?: string;
  readonly status?: string;
  readonly sessionId?: string;
};
type Worktree = {
  readonly id: string;
  readonly path: string;
  readonly branch: string;
  readonly agents?: Readonly<Record<string, Agent>>;
};
type Status = { readonly worktrees?: readonly Worktree[] };

class SpawnRefused extends Error {}

const SETUP: readonly (readonly string[])[] = [
  ['bun', 'install', '--frozen-lockfile'],
  ['bun', 'slot:up'],
];
const POLL_MS = 3_000;
const POLLS = 10;

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
  const active = activeBuilders(
    puStatus(deps),
    (path) => deps.read(join(path, '.daisy/role'))?.trim() as Role | undefined,
  );
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

async function turnsWhen(
  deps: SpawnDeps,
  path: string,
  done: (turns: number) => boolean,
): Promise<number> {
  let turns = 0;
  for (let poll = 0; poll < POLLS; poll += 1) {
    turns = userTurns(deps.read(path) ?? '');
    if (done(turns)) return turns;
    await deps.sleep(POLL_MS);
  }
  return turns;
}

/** Waits for the transcript to gain a user turn, nudging once if needed. */
export async function confirmSubmitted(
  deps: SpawnDeps,
  agentId: string,
  transcript: string,
  before: number,
): Promise<boolean> {
  const grew = (turns: number) => turns > before;
  if (grew(await turnsWhen(deps, transcript, grew))) return true;
  deps.out(`${agentId}: text not submitted; nudging with an empty pu send\n`);
  deps.run(['pu', 'send', agentId, '']);
  return grew(await turnsWhen(deps, transcript, grew));
}

function setUp(deps: SpawnDeps, worktree: Worktree, role: Role) {
  for (const step of SETUP) {
    deps.out(`${worktree.path}: ${step.join(' ')}\n`);
    if (deps.run(step, worktree.path).code !== 0)
      throw new SpawnRefused(
        `${step.join(' ')} failed in ${worktree.path}; no prompt was sent`,
      );
  }
  deps.write(join(worktree.path, '.daisy/role'), `${role}\n`);
  if (deps.parentId)
    deps.write(join(worktree.path, '.daisy/parent'), `${deps.parentId}\n`);
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
  setUp(deps, worktree, plan.role);
  const ready = puStatus(deps);
  deps.run(['pu', 'spawn', '-w', worktree.id, '-a', plan.agent, ...plan.rest]);
  const agent = newAgent(ready, puStatus(deps), worktree.id);
  if (!agent) throw new SpawnRefused('pu status shows no new agent');
  deps.out(
    `spawned ${agent.id} in ${worktree.path} (parent ${deps.parentId ?? 'owner'})\n`,
  );
  if (plan.agent !== 'claude' || !agent.sessionId) return 0;
  const transcript = transcriptPath(deps.home, worktree.path, agent.sessionId);
  const submitted = await confirmSubmitted(deps, agent.id, transcript, 0);
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
  const worktree = puStatus(deps).worktrees?.find((w) =>
    Object.hasOwn(w.agents ?? {}, agentId),
  );
  const agent = worktree?.agents?.[agentId];
  const transcript =
    worktree && agent?.sessionId
      ? transcriptPath(deps.home, worktree.path, agent.sessionId)
      : undefined;
  const before = transcript ? userTurns(deps.read(transcript) ?? '') : 0;
  if (deps.run(['pu', 'send', agentId, text]).code !== 0) return 1;
  if (!transcript) {
    deps.run(['pu', 'send', agentId, '']);
    deps.out(`${agentId}: no transcript to confirm against; nudged once\n`);
    return 0;
  }
  const submitted = await confirmSubmitted(deps, agentId, transcript, before);
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
    home: homedir(),
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
