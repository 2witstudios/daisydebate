#!/usr/bin/env bun
/**
 * The local guard (ADR 0035, soft layer). One pure classifier judges a shell
 * command, an edited file or a pushed ref; `.githooks/pre-push` and the
 * committed Claude Code PreToolUse hook both call it. With DAISY_AUTONOMOUS=1
 * it refuses what an agent must never do; in owner sessions it asks before a
 * merge or a push to main and allows the rest. It catches accidents: the
 * hard limits are the machine identity and the main ruleset.
 */
import { existsSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  allow,
  branchName,
  combine,
  deny,
  guardVariables,
  LOOP_REASON,
  pushTargetVerdict,
  resolveFrom,
  unwrap,
  type GuardFacts,
  type Rule,
  type Verdict,
} from './agent-guard-rules';
import { isLoopState, loopState } from './agent-guard-files';
import { gh } from './agent-guard-gh';
import { git } from './agent-guard-git';
import { kill } from './agent-guard-process';
import { bun, docker } from './agent-guard-stacks';
import { deriveSlot } from './slot-model';
import { parseShell } from './shell-command';

const shells = new Set(['sh', 'bash', 'zsh', 'dash']);
const rules: Readonly<Record<string, Rule>> = {
  git,
  gh,
  kill,
  pkill: kill,
  killall: kill,
  docker,
  'docker-compose': docker,
  bun,
};

/** Judges one shell command line, with every nested command it runs. */
export function classifyCommand(command: string, facts: GuardFacts): Verdict {
  const verdicts: Verdict[] = [];
  let cwd = facts.cwd;
  for (const simple of parseShell(command)) {
    const invocation = unwrap(simple);
    const [name = '', ...args] = invocation.words;
    verdicts.push(guardVariables(invocation, facts));
    verdicts.push(loopState(simple, invocation, facts));
    if (name === 'cd' || name === 'pushd')
      cwd = resolveFrom(cwd, args[0] ?? '~');
    else if (shells.has(name) && args.includes('-c'))
      verdicts.push(
        classifyCommand(args[args.indexOf('-c') + 1] ?? '', { ...facts, cwd }),
      );
    else if (name === 'eval')
      verdicts.push(classifyCommand(args.join(' '), { ...facts, cwd }));
    else if (rules[name]) verdicts.push(rules[name](invocation, facts, cwd));
  }
  return combine(verdicts);
}

/** Judges an Edit or Write tool call by its target path. */
export function classifyFileEdit(path: string, facts: GuardFacts): Verdict {
  return facts.autonomous && isLoopState(path) ? deny(LOOP_REASON) : allow;
}

/** Judges the refs git hands the pre-push hook on stdin. */
export function classifyPush(
  lines: readonly string[],
  facts: GuardFacts,
): Verdict {
  return combine(
    lines
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields.length === 4)
      .map(([, , remoteRef]) =>
        pushTargetVerdict(facts, branchName(remoteRef)),
      ),
  );
}

/** The Claude Code PreToolUse output: silent on allow. */
export function hookResponse(verdict: Verdict):
  | {
      readonly hookSpecificOutput: {
        readonly hookEventName: 'PreToolUse';
        readonly permissionDecision: 'deny' | 'ask';
        readonly permissionDecisionReason: string;
      };
    }
  | undefined {
  if (verdict.decision === 'allow') return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: verdict.decision,
      permissionDecisionReason: verdict.reason ?? 'Refused by the agent guard.',
    },
  };
}

// ------------------------------------------------------------------- edges

function run(args: readonly string[], cwd: string): string | undefined {
  const result = Bun.spawnSync([...args], {
    cwd: existsSync(cwd) ? cwd : undefined,
    stdout: 'pipe',
    stderr: 'ignore',
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}

function checkoutRoot(dir: string): string | undefined {
  let current = dir;
  while (!existsSync(current)) current = dirname(current);
  return run(['git', 'rev-parse', '--show-toplevel'], current);
}

/** The slot database of the checkout containing dir (ADR 0034). */
function slotDatabase(dir: string, mainCheckout: string): string | undefined {
  const checkout = checkoutRoot(dir);
  if (!checkout) return undefined;
  try {
    return deriveSlot({ checkout, mainCheckout }).database;
  } catch {
    return undefined;
  }
}

function processCwd(pid: number): string | undefined {
  if (existsSync(`/proc/${pid}/cwd`)) {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return undefined;
    }
  }
  return run(['lsof', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'], '/')
    ?.split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);
}

function liveFacts(cwd: string, projectDir?: string): GuardFacts {
  const worktree = checkoutRoot(projectDir ?? cwd) ?? cwd;
  const commonDir = run(
    ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    worktree,
  );
  const mainCheckout = commonDir ? dirname(commonDir) : worktree;
  return {
    autonomous: process.env.DAISY_AUTONOMOUS === '1',
    worktree,
    cwd: isAbsolute(cwd) ? cwd : resolve(worktree, cwd),
    mainCheckout,
    protectedBranches: ['main'],
    branchOf: (dir) =>
      run(['git', 'symbolic-ref', '--short', '-q', 'HEAD'], dir),
    databaseOf: (dir) => slotDatabase(dir, mainCheckout),
    processCwd,
  };
}

type HookInput = {
  readonly cwd?: string;
  readonly tool_name?: string;
  readonly tool_input?: {
    readonly command?: string;
    readonly file_path?: string;
    readonly notebook_path?: string;
  };
};

function judgeHook(input: HookInput, facts: GuardFacts): Verdict {
  const toolInput = input.tool_input ?? {};
  if (input.tool_name === 'Bash')
    return classifyCommand(toolInput.command ?? '', facts);
  const path = toolInput.file_path ?? toolInput.notebook_path;
  return path ? classifyFileEdit(resolve(facts.cwd, path), facts) : allow;
}

async function hook(): Promise<void> {
  let verdict: Verdict;
  try {
    const input = JSON.parse(await Bun.stdin.text()) as HookInput;
    const facts = liveFacts(
      input.cwd ?? process.cwd(),
      process.env.CLAUDE_PROJECT_DIR,
    );
    verdict = judgeHook(input, facts);
  } catch {
    // Fail closed for agents, open for the owner.
    verdict =
      process.env.DAISY_AUTONOMOUS === '1'
        ? deny('The agent guard could not read this tool call.')
        : allow;
  }
  const response = hookResponse(verdict);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}

function askOnTerminal(question: string): boolean {
  const answer = Bun.spawnSync(
    [
      'sh',
      '-c',
      'printf "%s [y/N] " "$1" > /dev/tty && read -r a < /dev/tty && printf "%s" "$a"',
      'ask',
      question,
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  // No terminal to ask on: an owner push from a tool already passed the
  // Claude hook's ask, so it goes through.
  if (answer.exitCode !== 0) return true;
  return /^y(?:es)?$/i.test(answer.stdout.toString().trim());
}

async function prePush(): Promise<void> {
  const lines = (await Bun.stdin.text()).split('\n');
  const verdict = classifyPush(lines, liveFacts(process.cwd()));
  if (verdict.decision === 'deny') {
    process.stderr.write(`pre-push: refused. ${verdict.reason}\n`);
    process.exitCode = 1;
  } else if (
    verdict.decision === 'ask' &&
    !askOnTerminal(`pre-push: ${verdict.reason} Push anyway?`)
  ) {
    process.stderr.write('pre-push: push cancelled.\n');
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  const [mode, command] = process.argv.slice(2);
  if (mode === 'hook') await hook();
  else if (mode === 'pre-push') await prePush();
  else if (mode === 'check' && command !== undefined)
    process.stdout.write(
      `${JSON.stringify(classifyCommand(command, liveFacts(process.cwd())))}\n`,
    );
  else {
    process.stderr.write(
      'usage: agent-guard.ts hook | pre-push | check "<command>"\n',
    );
    process.exitCode = 2;
  }
}
