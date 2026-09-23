/**
 * The agent guard's rules (ADR 0035): pure judgements of one simple shell
 * command against the facts of the session running it. agent-guard.ts
 * combines them across a command line and wires them to the hooks.
 */
import { resolve } from 'node:path';
import type { ShellCommand } from './shell-command';

type Decision = 'allow' | 'deny' | 'ask';
export type Verdict = { readonly decision: Decision; readonly reason?: string };

export type GuardFacts = {
  readonly autonomous: boolean;
  /** Root of the checkout this session owns. */
  readonly worktree: string;
  readonly cwd: string;
  readonly mainCheckout: string;
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

const MERGE_PATH =
  'push your branch and request the merge with `gh pr merge --auto --squash`; GitHub merges once every required check, including review-record, passes';
const MERGE_REASON = `Autonomous agents never merge directly: ${MERGE_PATH}.`;
export const RULE_REASON =
  'Rulesets, branch protection and repository settings are applied only by the owner (`bun github:rules --apply`, GRD-6.2).';
const KILL_REASON =
  'Kill only processes in your own worktree: `pkill -f "<your worktree path>/…"` or `kill <pid>` of a process whose working directory is inside it. Other sessions share this machine.';
export const LOOP_REASON =
  'A loop ends only through its truthful completion promise. To pause it, run `bun loop:escalate <needs-owner|blocked|stalled|out-of-scope> "<detail>"`; only the parent or the owner can close or resume it.';

/** Autonomous sessions are refused; owner sessions are asked. */
const refuseOrAsk = (facts: GuardFacts, reason: string): Verdict =>
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

export const resolveFrom = (cwd: string, path: string): string =>
  path.startsWith('~') ? `/~${path.slice(1)}` : resolve(cwd, path);

export const branchName = (ref: string): string =>
  ref.replace(/^refs\/heads\//, '');

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
};
const passthrough = new Set(['nohup', 'command', 'exec', 'builtin']);

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
    } else index += options.has(word) ? 2 : 1;
  }
  // timeout takes a duration before the command.
  return head === 'timeout' ? index + 1 : index;
}

/** Strips wrappers (env, sudo, xargs, nohup, …) down to the real command. */
export function unwrap(command: ShellCommand): Invocation {
  const result: Unwrapped = {
    words: command.words,
    assignments: { ...command.assignments },
    unset: [],
  };
  for (;;) {
    const [head, ...rest] = result.words;
    if (head !== undefined && passthrough.has(head)) result.words = rest;
    else if (head !== undefined && head in wrapperValueOptions)
      result.words = rest.slice(wrapperArgsEnd(head, rest, result));
    else return result;
  }
}

// ------------------------------------------------------------------- rules

const GUARD_VARIABLES = new Set(['DAISY_AUTONOMOUS', 'PU_AGENT_ID']);

export function guardVariables(
  invocation: Invocation,
  facts: GuardFacts,
): Verdict {
  const [name, ...args] = invocation.words;
  const declares = name === 'unset' || name === 'export' || name === 'declare';
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

const pushValueOptions = new Set([
  '--repo',
  '-o',
  '--push-option',
  '--receive-pack',
  '--exec',
]);

function pushTarget(refspec: string, current: string | undefined) {
  const spec = refspec.replace(/^\+/, '');
  const destination = spec.includes(':')
    ? spec.slice(spec.indexOf(':') + 1)
    : spec;
  return destination === 'HEAD' ? current : branchName(destination);
}

function gitPush(args: readonly string[], facts: GuardFacts, dir: string) {
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (pushValueOptions.has(arg)) index += 1;
    else if (arg.startsWith('-')) flags.add(splitFlag(arg)[0]);
    else positional.push(arg);
  }
  const current = facts.branchOf(dir);
  const refspecs = positional.slice(1);
  const targets =
    refspecs.length === 0
      ? [current]
      : refspecs.map((refspec) => pushTarget(refspec, current));
  return combine([
    flags.has('--no-verify')
      ? autonomousOnly(
          facts,
          'The pre-push hook is the guard for every agent tool; an autonomous push may not skip it with --no-verify.',
        )
      : allow,
    flags.has('--all') || flags.has('--mirror')
      ? refuseOrAsk(
          facts,
          `git push --all or --mirror would update main. Push only your branch, then ${MERGE_PATH}.`,
        )
      : allow,
    ...targets.map((target) =>
      target === undefined
        ? autonomousOnly(
            facts,
            'Cannot tell which branch this push updates; push an explicit branch name.',
          )
        : pushTargetVerdict(facts, target),
    ),
  ]);
}

export const git: Rule = (invocation, facts, cwd) => {
  const [, ...rest] = invocation.words;
  let dir = cwd;
  let hooksOverride = false;
  let index = 0;
  while (index < rest.length && rest[index].startsWith('-')) {
    const option = rest[index];
    if (option === '-C') dir = resolveFrom(dir, rest[index + 1] ?? '');
    if (option === '-c')
      hooksOverride ||= /^core\.hookspath=/i.test(rest[index + 1] ?? '');
    index += option === '-C' || option === '-c' ? 2 : 1;
  }
  return combine([
    hooksOverride
      ? autonomousOnly(
          facts,
          'Overriding core.hooksPath disables the pre-push guard.',
        )
      : allow,
    rest[index] === 'push' ? gitPush(rest.slice(index + 1), facts, dir) : allow,
  ]);
};

const apiValueOptions = new Set([
  '-X',
  '--method',
  '-H',
  '--header',
  '-f',
  '-F',
  '--field',
  '--raw-field',
  '--input',
  '-q',
  '--jq',
  '-t',
  '--template',
  '--hostname',
  '--cache',
  '-p',
  '--preview',
]);
const bodyOptions = new Set(['-f', '-F', '--field', '--raw-field', '--input']);
const MERGE_MUTATIONS = /\b(?:mergePullRequest|mergeBranch)\b/;
const RULE_MUTATIONS =
  /\b(?:(?:create|update|delete)BranchProtectionRule|(?:create|update|delete)RepositoryRuleset|updateRepository)\b/;
const RULE_ENDPOINTS = [
  /(?:^|\/)rulesets(?:\/|$)/,
  /\/branches\/[^/]+\/protection/,
  /^repos\/[^/]+\/[^/]+\/?$/,
  /\/git\/refs\/heads\//,
];

type ApiCall = { method: string; endpoint: string };

function parseApiCall(args: readonly string[]): ApiCall {
  let method: string | undefined;
  let hasBody = false;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inline] = splitFlag(arg);
    const takesValue = arg.startsWith('-') && apiValueOptions.has(flag);
    if (!arg.startsWith('-')) positional.push(arg);
    if (flag === '-X' || flag === '--method')
      method = (inline ?? args[index + 1] ?? '').toUpperCase();
    hasBody ||= takesValue && bodyOptions.has(flag);
    if (takesValue && inline === undefined) index += 1;
  }
  return {
    method: method ?? (hasBody ? 'POST' : 'GET'),
    endpoint: (positional[0] ?? '').replace(/^\//, ''),
  };
}

function ghApi(args: readonly string[], facts: GuardFacts): Verdict {
  const { method, endpoint } = parseApiCall(args);
  const text = args.join(' ');
  if (endpoint === 'graphql')
    return combine([
      MERGE_MUTATIONS.test(text) ? refuseOrAsk(facts, MERGE_REASON) : allow,
      RULE_MUTATIONS.test(text) ? autonomousOnly(facts, RULE_REASON) : allow,
    ]);
  if (method === 'GET' || method === 'HEAD') return allow;
  if (/\/pulls\/\d+\/merge\/?$/.test(endpoint))
    return refuseOrAsk(facts, MERGE_REASON);
  return RULE_ENDPOINTS.some((pattern) => pattern.test(endpoint))
    ? autonomousOnly(facts, RULE_REASON)
    : allow;
}

export const gh: Rule = (invocation, facts) => {
  const [, group, action, ...args] = invocation.words;
  if (group === 'api') return ghApi([action ?? '', ...args], facts);
  if (group === 'repo' && action === 'edit')
    return autonomousOnly(facts, RULE_REASON);
  if (group !== 'pr' || action !== 'merge') return allow;
  if (args.includes('--admin'))
    return refuseOrAsk(
      facts,
      `--admin bypasses the main ruleset. ${MERGE_REASON}`,
    );
  return args.includes('--auto') ? allow : refuseOrAsk(facts, MERGE_REASON);
};

function killTargets(args: readonly string[]): readonly string[] {
  const targets: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    // A leading -9 or -TERM names the signal; -1 is "every process".
    const signal = index === 0 && /^-[A-Za-z0-9]+$/.test(arg) && arg !== '-1';
    if (arg === '-s' || arg === '-n') index += 1;
    else if (!signal && arg !== '--') targets.push(arg);
  }
  return targets;
}

function ownsPid(target: string, facts: GuardFacts): boolean {
  if (/^%\d*$/.test(target)) return true;
  if (!/^\d+$/.test(target)) return false;
  const cwd = facts.processCwd(Number(target));
  return cwd !== undefined && isWithin(cwd, facts.worktree);
}

export const kill: Rule = (invocation, facts) => {
  const [name, ...args] = invocation.words;
  if (!facts.autonomous || args.includes('-l')) return allow;
  if (name === 'pkill') {
    const pattern = args.filter((arg) => !arg.startsWith('-')).at(-1) ?? '';
    const scoped = args.includes('-f') && pattern.includes(facts.worktree);
    return scoped ? allow : deny(KILL_REASON);
  }
  const targets = name === 'killall' ? [] : killTargets(args);
  return targets.length > 0 && targets.every((t) => ownsPid(t, facts))
    ? allow
    : deny(KILL_REASON);
};

const LOOP_STATE = /ralph-loop\.(?:local|escalated)\.md/;
const fileMutators = new Set([
  'rm',
  'mv',
  'cp',
  'unlink',
  'truncate',
  'tee',
  'shred',
  'ln',
  'touch',
  'dd',
  'install',
]);

export const isLoopState = (path: string): boolean => LOOP_STATE.test(path);

export function loopState(
  command: ShellCommand,
  invocation: Invocation,
  facts: GuardFacts,
): Verdict {
  const [name = '', ...args] = invocation.words;
  const inPlace =
    (name === 'sed' || name === 'perl') &&
    args.some((arg) => /^-[A-Za-z]*i/.test(arg));
  const mutates =
    command.redirects.some(isLoopState) ||
    ((fileMutators.has(name) || inPlace) && args.some(isLoopState));
  return facts.autonomous && mutates ? deny(LOOP_REASON) : allow;
}
