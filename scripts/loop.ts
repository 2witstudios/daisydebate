#!/usr/bin/env bun
/**
 * PR loop control (ADR 0035):
 *   bun loop:escalate <needs-owner|blocked|stalled|out-of-scope> "<detail>"
 *     run by the loop agent: pauses its loop, notifies its parent (or the
 *     owner) and records the escalation on the PR;
 *   bun loop:close <agent> "<why>" and bun loop:resume <agent> "<instructions>"
 *     run by the parent or the owner: end or restart the paused loop and
 *     record the outcome on the PR.
 * All I/O goes through LoopDeps so the flows are tested against fakes.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authorizeControl,
  escalateState,
  escalationField,
  escalationMessage,
  parseReason,
  readIteration,
  resumeState,
  REASONS,
} from './loop-state';

export const ACTIVE = '.claude/ralph-loop.local.md';
export const ESCALATED = '.claude/ralph-loop.escalated.md';
export const PARENT = '.daisy/parent';

export type LoopDeps = {
  readonly cwd: string;
  readonly autonomous: boolean;
  readonly agentId: string | undefined;
  readonly now: () => string;
  readonly read: (path: string) => string | undefined;
  readonly write: (path: string, text: string) => void;
  readonly remove: (path: string) => void;
  readonly run: (
    args: readonly string[],
    cwd: string,
  ) => { readonly code: number; readonly stdout: string };
  readonly notice: (text: string) => void;
};

type Worktree = { readonly path: string; readonly branch: string };

/** Finds an agent's worktree in `pu status --json` output. */
export function findAgentWorktree(
  status: string,
  agentId: string,
): Worktree | undefined {
  const parsed = JSON.parse(status) as {
    worktrees?: {
      path: string;
      branch: string;
      agents?: Record<string, unknown>;
    }[];
  };
  const match = parsed.worktrees?.find((worktree) =>
    Object.hasOwn(worktree.agents ?? {}, agentId),
  );
  return match && { path: match.path, branch: match.branch };
}

function sendTo(deps: LoopDeps, agent: string, text: string): boolean {
  // pu often leaves text unsubmitted; an empty send presses Enter.
  const sent = deps.run(['pu', 'send', agent, text], deps.cwd).code === 0;
  deps.run(['pu', 'send', agent, ''], deps.cwd);
  return sent;
}

function commentOnPr(deps: LoopDeps, pr: number, body: string, dir: string) {
  const ok =
    deps.run(['gh', 'pr', 'comment', String(pr), '--body', body], dir).code ===
    0;
  if (!ok) deps.notice(`Could not comment on PR #${pr}.`);
}

function prNumber(deps: LoopDeps, args: readonly string[], dir: string) {
  const result = deps.run(['gh', ...args], dir);
  const value = Number(result.stdout.trim());
  return result.code === 0 && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function escalate(
  deps: LoopDeps,
  reasonText: string,
  detail: string,
): number {
  const reason = parseReason(reasonText);
  if (!reason || detail.trim() === '') {
    deps.notice(
      `usage: bun loop:escalate <${REASONS.join('|')}> "<what only the parent or owner can resolve>"`,
    );
    return 2;
  }
  const state = deps.read(join(deps.cwd, ACTIVE));
  if (state === undefined) {
    deps.notice(`No active loop: ${ACTIVE} does not exist.`);
    return 1;
  }
  const parent = deps.read(join(deps.cwd, PARENT))?.trim() || undefined;
  const escalation = {
    reason,
    detail: detail.trim(),
    sha: deps.run(['git', 'rev-parse', 'HEAD'], deps.cwd).stdout.trim(),
    at: deps.now(),
    child: deps.agentId ?? 'owner-session',
    parent,
    pr: prNumber(
      deps,
      ['pr', 'view', '--json', 'number', '--jq', '.number'],
      deps.cwd,
    ),
  };
  deps.write(join(deps.cwd, ESCALATED), escalateState(state, escalation));
  deps.remove(join(deps.cwd, ACTIVE));
  const message = escalationMessage({
    ...escalation,
    iteration: readIteration(state),
  });
  if (escalation.pr !== undefined)
    commentOnPr(
      deps,
      escalation.pr,
      `**Loop escalated: ${reason}** (waiting for ${parent ?? 'the owner'})\n\n${message}`,
      deps.cwd,
    );
  if (parent) sendTo(deps, parent, message);
  else deps.notice(`OWNER NOTICE ${message}`);
  deps.notice(
    `Loop paused (${reason}). Stop working on the loop now; ${parent ?? 'the owner'} will close or resume it.`,
  );
  return 0;
}

type Control = 'close' | 'resume';
type Paused = {
  readonly worktree: Worktree;
  readonly state: string;
  readonly parent: string | undefined;
};

/** The child's paused loop and its recorded parent, or a notice. */
function findPaused(deps: LoopDeps, child: string): Paused | string {
  const status = deps.run(['pu', 'status', '--json'], deps.cwd);
  const worktree =
    status.code === 0 ? findAgentWorktree(status.stdout, child) : undefined;
  if (!worktree) return `pu status does not list agent ${child}.`;
  const state = deps.read(join(worktree.path, ESCALATED));
  if (state === undefined)
    return `${child} has no escalated loop (${ESCALATED}).`;
  const recorded = escalationField(state, 'parent');
  const parent =
    deps.read(join(worktree.path, PARENT))?.trim() ||
    (recorded === 'owner' ? undefined : recorded);
  return { worktree, state, parent };
}

function report(
  deps: LoopDeps,
  action: Control,
  child: string,
  paused: Paused,
  line: string,
) {
  const verb = action === 'close' ? 'closed' : 'resumed';
  sendTo(
    deps,
    child,
    action === 'close'
      ? `[loop] Your loop was ${line}. It will not resume. Finish your handoff: commit, push, update the handoff page and report to your parent.`
      : `[loop] Your loop was ${line}`,
  );
  const pr = prNumber(
    deps,
    [
      'pr',
      'list',
      '--head',
      paused.worktree.branch,
      '--json',
      'number',
      '--jq',
      '.[0].number',
    ],
    paused.worktree.path,
  );
  if (pr !== undefined)
    commentOnPr(
      deps,
      pr,
      `**Loop ${verb}** ${line.replace(/^\S+ /, '')}`,
      paused.worktree.path,
    );
  deps.notice(`Loop of ${child} ${verb}.`);
}

export function control(
  deps: LoopDeps,
  action: Control,
  child: string,
  text: string,
): number {
  if (!child || text.trim() === '') {
    deps.notice(
      `usage: bun loop:${action} <agent> "<${action === 'close' ? 'why' : 'instructions'}>"`,
    );
    return 2;
  }
  const paused = findPaused(deps, child);
  const refusal =
    typeof paused === 'string'
      ? paused
      : authorizeControl({
          autonomous: deps.autonomous,
          caller: deps.agentId,
          parent: paused.parent,
          child,
        });
  if (refusal !== undefined || typeof paused === 'string') {
    deps.notice(refusal ?? '');
    return 1;
  }
  if (action === 'resume')
    deps.write(join(paused.worktree.path, ACTIVE), resumeState(paused.state));
  deps.remove(join(paused.worktree.path, ESCALATED));
  const who = deps.autonomous ? (deps.agentId ?? 'agent') : 'the owner';
  const verb = action === 'close' ? 'closed' : 'resumed';
  report(deps, action, child, paused, `${verb} by ${who}: ${text.trim()}`);
  return 0;
}

function liveDeps(): LoopDeps {
  return {
    cwd: process.cwd(),
    autonomous: process.env.DAISY_AUTONOMOUS === '1',
    agentId: process.env.PU_AGENT_ID || undefined,
    now: () => new Date().toISOString(),
    read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
    write: (path, text) => writeFileSync(path, text),
    remove: (path) => rmSync(path, { force: true }),
    run: (args, cwd) => {
      const result = Bun.spawnSync([...args], {
        cwd,
        stdout: 'pipe',
        stderr: 'inherit',
      });
      return { code: result.exitCode, stdout: result.stdout.toString() };
    },
    notice: (text) => process.stderr.write(`${text}\n`),
  };
}

if (import.meta.main) {
  const [action, first = '', ...rest] = process.argv.slice(2);
  const deps = liveDeps();
  if (action === 'escalate')
    process.exitCode = escalate(deps, first, rest.join(' '));
  else if (action === 'close' || action === 'resume')
    process.exitCode = control(deps, action, first, rest.join(' '));
  else {
    deps.notice('usage: loop.ts escalate|close|resume …');
    process.exitCode = 2;
  }
}
