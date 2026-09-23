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
  isAgentSession,
  resolveFrom,
  unwrap,
  type GuardFacts,
  type Rule,
  type Verdict,
} from './agent-guard-rules';
import { isProtectedFile, loopState } from './agent-guard-files';
import { gh } from './agent-guard-gh';
import { git } from './agent-guard-git';
import { kill, otherKillers } from './agent-guard-process';
import { bun, docker } from './agent-guard-stacks';
import { identityRegime } from './agent-identity';
import { IDENTITY_REASON, identityVerdict } from './agent-guard-identity';
import { deriveSlot } from './slot-model';
import { parseShell } from './shell-command';

const shells = new Set(['sh', 'bash', 'zsh', 'dash']);
const rules: Readonly<Record<string, Rule>> = {
  git,
  gh,
  kill,
  pkill: kill,
  killall: kill,
  fuser: otherKillers,
  launchctl: otherKillers,
  bunx: otherKillers,
  npx: otherKillers,
  docker,
  'docker-compose': docker,
  bun,
};

// Shell options that take the next word as their value.
const SHELL_VALUE_OPTIONS = new Set([
  '-o',
  '+o',
  '-O',
  '+O',
  '--rcfile',
  '--init-file',
]);

/**
 * What a shell invocation runs. With -c anywhere in its options (alone or in
 * a cluster such as -lc or -xc) the command is the first operand after all
 * options, so bash -c -e "cmd" and bash -O x -c "cmd" run "cmd"; otherwise
 * the first operand is a script file, and with none it reads stdin.
 */
function shellInput(args: readonly string[]) {
  let command = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (SHELL_VALUE_OPTIONS.has(arg)) index += 1;
    else if (arg === '--') {
      const operand = args[index + 1];
      if (command) return { script: operand ?? '' };
      return operand === undefined ? { stdin: true } : { file: operand };
    } else if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg)) command = true;
    else if (!arg.startsWith('-') && !arg.startsWith('+'))
      return command ? { script: arg } : { file: arg };
  }
  return command ? { script: '' } : { stdin: true };
}

function shellVerdict(args: readonly string[], facts: GuardFacts): Verdict {
  const input = shellInput(args);
  if ('script' in input) return classifyCommand(input.script ?? '', facts);
  return 'stdin' in input && facts.autonomous
    ? deny(
        'Commands piped into a shell cannot be checked by the guard. Run them directly, or put them in a script file.',
      )
    : allow;
}

/** Judges one shell command line, with every nested command it runs. */
export function classifyCommand(command: string, given: GuardFacts): Verdict {
  // A misconfigured agent is still an agent: every agent rule applies.
  const facts = given.misconfigured ? { ...given, autonomous: true } : given;
  const verdicts: Verdict[] = [];
  let cwd = facts.cwd;
  for (const simple of parseShell(command)) {
    const invocation = unwrap(simple);
    const [name = '', ...args] = invocation.words;
    verdicts.push(identityVerdict(name, args, facts));
    verdicts.push(guardVariables(invocation, facts));
    verdicts.push(loopState(simple, invocation, facts, cwd));
    if (name === 'cd' || name === 'pushd')
      cwd = resolveFrom(cwd, args[0] ?? '~', facts.home);
    else if (shells.has(name))
      verdicts.push(shellVerdict(args, { ...facts, cwd }));
    else if (name === 'eval')
      verdicts.push(classifyCommand(args.join(' '), { ...facts, cwd }));
    else if (rules[name]) verdicts.push(rules[name](invocation, facts, cwd));
  }
  return combine(verdicts);
}

/** Judges an Edit or Write tool call by its target path. */
export function classifyFileEdit(path: string, facts: GuardFacts): Verdict {
  return facts.autonomous && isProtectedFile(path, facts)
    ? deny(LOOP_REASON)
    : allow;
}

/** Judges the refs git hands the pre-push hook on stdin. */
export function classifyPush(
  lines: readonly string[],
  facts: GuardFacts,
): Verdict {
  if (facts.misconfigured) return deny(IDENTITY_REASON);
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
    // Stay well inside the hook's 30 s budget; a timeout reads as unknown.
    timeout: 5_000,
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
    autonomous: isAgentSession(process.env),
    misconfigured:
      identityRegime(process.env, existsSync, mainCheckout) === 'misconfigured',
    worktree,
    home: process.env.HOME,
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

/**
 * What the owner's answer at the pre-push prompt means. Exit 3: there is no
 * terminal (a tool push already passed the Claude hook's ask), so it goes
 * through. Exit 4: input ended (Ctrl-D) without an answer, so it does not.
 */
export function terminalAnswer(
  exitCode: number | null,
  text: string,
): 'push' | 'cancel' | 'no-terminal' {
  if (exitCode === 3) return 'no-terminal';
  if (exitCode !== 0) return 'cancel';
  return /^y(?:es)?$/i.test(text.trim()) ? 'push' : 'cancel';
}

function askOnTerminal(question: string): boolean {
  const answer = Bun.spawnSync(
    [
      'sh',
      '-c',
      'exec 3<>/dev/tty 2>/dev/null || exit 3; printf "%s [y/N] " "$1" >&3; IFS= read -r a <&3 || exit 4; printf "%s" "$a"',
      'ask',
      question,
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  const meaning = terminalAnswer(answer.exitCode, answer.stdout.toString());
  if (meaning === 'no-terminal')
    process.stderr.write('pre-push: no terminal to ask on; pushing.\n');
  return meaning !== 'cancel';
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
