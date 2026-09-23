/**
 * The agent guard's process rules (ADR 0035): an agent kills only processes
 * of its own worktree; other sessions share the machine.
 */
import {
  allow,
  deny,
  isWithin,
  KILL_REASON,
  type GuardFacts,
  type Rule,
} from './agent-guard-rules';

function killTargets(args: readonly string[]): readonly string[] {
  const targets: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    // A leading -9 or -TERM names the signal; -1 is "every process".
    const signal = index === 0 && /^-[A-Za-z0-9]+$/.test(arg) && arg !== '-1';
    if (arg === '-s' || arg === '-n') index += 1;
    // A stray -l later on does not stop the shell from killing the pids.
    else if (!signal && arg !== '--' && arg !== '-l' && arg !== '-L')
      targets.push(arg);
  }
  return targets;
}

/** kill -l / -L with only signal numbers or names: it lists, never kills. */
const listsSignals = (args: readonly string[]): boolean =>
  (args[0] === '-l' || args[0] === '-L') &&
  args
    .slice(1)
    .every(
      (arg) => /^[A-Za-z]+$/.test(arg) || (/^\d{1,2}$/.test(arg) && +arg <= 64),
    );

function ownsPid(target: string, facts: GuardFacts): boolean {
  if (/^%\d*$/.test(target)) return true;
  if (!/^\d+$/.test(target)) return false;
  const cwd = facts.processCwd(Number(target));
  return cwd !== undefined && isWithin(cwd, facts.worktree);
}

/**
 * A pkill -f pattern is scoped only when it names the worktree and adds no
 * alternation or grouping that could match other processes too.
 */
function scopedPattern(args: readonly string[], worktree: string): boolean {
  const pattern = args.filter((arg) => !arg.startsWith('-')).at(-1) ?? '';
  const rest = pattern.split(worktree).join('');
  return (
    args.includes('-f') && pattern.includes(worktree) && !/[|()]/.test(rest)
  );
}

export const kill: Rule = (invocation, facts) => {
  const [name, ...args] = invocation.words;
  if (!facts.autonomous || (name === 'kill' && listsSignals(args)))
    return allow;
  if (name === 'pkill')
    return scopedPattern(args, facts.worktree) ? allow : deny(KILL_REASON);
  const targets = name === 'killall' ? [] : killTargets(args);
  return targets.length > 0 && targets.every((t) => ownsPid(t, facts))
    ? allow
    : deny(KILL_REASON);
};

const KILLER_PACKAGES = /^(?:kill-port|fkill|fkill-cli)(?:@|$)/;
const LAUNCHCTL_STOPS = new Set([
  'kill',
  'stop',
  'bootout',
  'remove',
  'unload',
]);

/** Other ways to kill processes by port or service, never scoped to a worktree. */
export const otherKillers: Rule = (invocation, facts) => {
  const [name, first = '', ...rest] = invocation.words;
  const kills =
    (name === 'fuser' &&
      [first, ...rest].some((arg) => /^-[a-zA-Z]*k/.test(arg))) ||
    (name === 'launchctl' && LAUNCHCTL_STOPS.has(first)) ||
    ((name === 'bunx' || name === 'npx') && KILLER_PACKAGES.test(first));
  return facts.autonomous && kills ? deny(KILL_REASON) : allow;
};
