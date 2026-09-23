/**
 * The agent guard's rules (ADR 0035): pure judgements of one simple shell
 * command against the facts of the session running it. agent-guard.ts
 * combines them across a command line and wires them to the hooks.
 */
import { basename, resolve } from 'node:path';
import { parseShell, type ShellCommand } from './shell-command';

type Decision = 'allow' | 'deny' | 'ask';
export type Verdict = { readonly decision: Decision; readonly reason?: string };

export type GuardFacts = {
  readonly autonomous: boolean;
  /** Root of the checkout this session owns. */
  readonly worktree: string;
  readonly cwd: string;
  readonly mainCheckout: string;
  /** $HOME, for paths spelled with ~ or $HOME. */
  readonly home?: string;
  readonly protectedBranches: readonly string[];
  readonly branchOf: (dir: string) => string | undefined;
  /** The slot database (ADR 0034) of the checkout containing dir. */
  readonly databaseOf: (dir: string) => string | undefined;
  readonly processCwd: (pid: number) => string | undefined;
};

export type Invocation = {
  readonly words: readonly string[];
  readonly assignments: Readonly<Record<string, string>>;
  readonly unset: readonly string[];
};

export type Rule = (
  invocation: Invocation,
  facts: GuardFacts,
  cwd: string,
) => Verdict;

export const allow: Verdict = { decision: 'allow' };
export const deny = (reason: string): Verdict => ({ decision: 'deny', reason });

export const MERGE_PATH =
  'push your branch; once the live main ruleset requires review-record (the check in ADR 0035 section 4), request the merge with `gh pr merge --auto --merge`, and until then report "ready for owner merge" to your parent';
export const MERGE_REASON = `Autonomous agents never merge directly: ${MERGE_PATH}.`;
export const RULE_REASON =
  'Rulesets, branch protection and repository settings are applied only by the owner (`bun github:rules --apply`, GRD-6.2).';
export const KILL_REASON =
  'Kill only processes in your own worktree: `pkill -f "<your worktree path>/…"` or `kill <pid>` of a process whose working directory is inside it. Other sessions share this machine.';
export const LOOP_REASON =
  'Loop state, the .daisy agent records and the guard hooks (.claude/settings.json, .githooks) are not changed by an agent by hand. A loop ends only through its truthful completion promise. To pause it, run `bun loop:escalate <needs-owner|blocked|stalled|out-of-scope> "<detail>"`; only the parent or the owner can close or resume it.';

/**
 * Agent mode: DAISY_AUTONOMOUS=1 or any PU_AGENT_ID, so clearing one of the
 * two variables never turns an agent into the owner.
 */
export const isAgentSession = (
  env: Readonly<Record<string, string | undefined>>,
): boolean => env.DAISY_AUTONOMOUS === '1' || Boolean(env.PU_AGENT_ID);

/** Autonomous sessions are refused; owner sessions are asked. */
export const refuseOrAsk = (facts: GuardFacts, reason: string): Verdict =>
  facts.autonomous ? deny(reason) : { decision: 'ask', reason };

export const autonomousOnly = (facts: GuardFacts, reason: string): Verdict =>
  facts.autonomous ? deny(reason) : allow;

export function combine(verdicts: readonly Verdict[]): Verdict {
  return (
    verdicts.find((verdict) => verdict.decision === 'deny') ??
    verdicts.find((verdict) => verdict.decision === 'ask') ??
    allow
  );
}

export const isWithin = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/**
 * A path argument as the shell would resolve it: ~, $HOME and $PWD are
 * expanded (the parser leaves them literal), then it is resolved from cwd.
 */
export function resolveFrom(cwd: string, path: string, home?: string): string {
  const expanded = path
    .replace(/^\$\{?PWD\}?(?=\/|$)/, cwd)
    .replace(/^(?:~|\$\{?HOME\}?)(?=\/|$)/, home ?? '/~');
  return resolve(cwd, expanded);
}

/** The branch a push destination names: main, heads/main, refs/heads/main. */
export const branchName = (ref: string): string =>
  ref.replace(/^refs\//, '').replace(/^heads\//, '');

export const pushTargetVerdict = (
  facts: GuardFacts,
  branch: string,
): Verdict =>
  facts.protectedBranches.includes(branch)
    ? refuseOrAsk(
        facts,
        `This push updates ${branch}. Autonomous agents never push to ${branch}: ${MERGE_PATH}.`,
      )
    : allow;

/** Splits `--flag=value` and `-Xvalue` into the flag and its inline value. */
export function splitFlag(arg: string): readonly [string, string | undefined] {
  if (arg.startsWith('--')) {
    const at = arg.indexOf('=');
    return at === -1 ? [arg, undefined] : [arg.slice(0, at), arg.slice(at + 1)];
  }
  return arg.length > 2 ? [arg.slice(0, 2), arg.slice(2)] : [arg, undefined];
}

// ---------------------------------------------------------------- wrappers

const wrapperValueOptions: Readonly<Record<string, ReadonlySet<string>>> = {
  sudo: new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U']),
  nice: new Set(['-n']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  xargs: new Set(['-n', '-I', '-P', '-L', '-d', '-E', '-s', '-a']),
  env: new Set(['-C', '-S', '--chdir', '--split-string']),
  time: new Set(),
  // command -p and exec -a name run the command that follows.
  command: new Set(),
  exec: new Set(['-a']),
};
const passthrough = new Set(['nohup', 'builtin']);

type Unwrapped = {
  words: readonly string[];
  assignments: Record<string, string>;
  unset: string[];
};

/** Consumes one wrapper's options; returns the index of its command. */
function wrapperArgsEnd(
  head: string,
  rest: readonly string[],
  into: Unwrapped,
) {
  const options = wrapperValueOptions[head];
  let index = 0;
  while (index < rest.length) {
    const word = rest[index];
    if (head === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      const at = word.indexOf('=');
      into.assignments[word.slice(0, at)] = word.slice(at + 1);
      index += 1;
    } else if (!word.startsWith('-') || word === '-') break;
    else if (head === 'env' && (word === '-u' || word === '--unset')) {
      into.unset.push(rest[index + 1] ?? '');
      index += 2;
    } else if (head === 'env' && /^(?:-u.|--unset=)/.test(word)) {
      // -uVAR and --unset=VAR name the variable in the same word.
      into.unset.push(word.replace(/^(?:-u|--unset=)/, ''));
      index += 1;
    } else index += options.has(word) ? 2 : 1;
  }
  // timeout takes a duration before the command.
  return head === 'timeout' ? index + 1 : index;
}

/**
 * env -S "cmd args" (--split-string) runs its value as a command line: the
 * words it would run, followed by env's remaining arguments.
 */
function envSplitString(args: readonly string[]): string[] | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const [flag, inline] = splitFlag(args[index]);
    if (flag !== '-S' && flag !== '--split-string') continue;
    const value = inline ?? args[index + 1] ?? '';
    const after = args.slice(index + (inline === undefined ? 2 : 1));
    return [...(parseShell(value)[0]?.words ?? []), ...after];
  }
  return undefined;
}

/** Strips wrappers (env, sudo, xargs, nohup, …) down to the real command. */
export function unwrap(command: ShellCommand): Invocation {
  const result: Unwrapped = {
    words: command.words,
    assignments: { ...command.assignments },
    unset: [],
  };
  for (;;) {
    const [path, ...rest] = result.words;
    // /usr/bin/git is git.
    const head = path === undefined ? undefined : basename(path);
    const split = head === 'env' ? envSplitString(rest) : undefined;
    if (split) result.words = split;
    else if (head !== undefined && passthrough.has(head)) result.words = rest;
    else if (head !== undefined && head in wrapperValueOptions)
      result.words = rest.slice(wrapperArgsEnd(head, rest, result));
    else return { ...result, words: head ? [head, ...rest] : result.words };
  }
}

// ------------------------------------------------------------------- rules

const GUARD_VARIABLES = new Set(['DAISY_AUTONOMOUS', 'PU_AGENT_ID']);

export function guardVariables(
  invocation: Invocation,
  facts: GuardFacts,
): Verdict {
  const [name, ...args] = invocation.words;
  const declares = ['unset', 'export', 'declare', 'typeset'].includes(
    name ?? '',
  );
  const exported = declares
    ? Object.fromEntries(
        args.map((arg) => {
          const at = arg.indexOf('=');
          return at === -1 ? [arg, ''] : [arg.slice(0, at), arg.slice(at + 1)];
        }),
      )
    : {};
  const hooks = [invocation.assignments, exported].some((values) =>
    Object.entries(values).some(
      ([key, value]) =>
        /^GIT_CONFIG_(?:KEY_\d+|PARAMETERS)$/.test(key) &&
        /core\.hookspath/i.test(value),
    ),
  );
  if (hooks)
    return autonomousOnly(
      facts,
      'Overriding core.hooksPath disables the pre-push guard.',
    );
  const touched =
    Object.keys(invocation.assignments).some((key) =>
      GUARD_VARIABLES.has(key),
    ) ||
    invocation.unset.some((key) => GUARD_VARIABLES.has(key)) ||
    (declares && args.some((arg) => GUARD_VARIABLES.has(arg.split('=')[0])));
  return touched
    ? autonomousOnly(
        facts,
        'DAISY_AUTONOMOUS and PU_AGENT_ID identify this session to the guard and to loop control; an agent may not clear or override them.',
      )
    : allow;
}
