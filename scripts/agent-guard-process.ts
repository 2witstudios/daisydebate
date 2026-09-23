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

// pkill options that take a value; their values are not patterns.
const PKILL_VALUE_OPTIONS = new Set([
  '-F',
  '-G',
  '-g',
  '-P',
  '-s',
  '-t',
  '-U',
  '-u',
  '-J',
]);

/**
 * A pkill -f is scoped only with a single pattern that names the worktree,
 * no alternation or grouping that could match other processes too, and no
 * -v, which inverts the match to every other process.
 */
function scopedPattern(args: readonly string[], worktree: string): boolean {
  const patterns: string[] = [];
  const flags: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (PKILL_VALUE_OPTIONS.has(args[index])) index += 1;
    else if (args[index].startsWith('-')) flags.push(args[index]);
    else patterns.push(args[index]);
  }
  const [pattern = ''] = patterns;
  // -v in a cluster, or --inverse and any prefix of it getopt accepts.
  const inverted = flags.some(
    (flag) =>
      /^-[a-zA-Z]*v/.test(flag) ||
      (flag.length >= 5 && '--inverse'.startsWith(flag)),
  );
  return (
    flags.some((flag) => /^-[a-zA-Z]*f/.test(flag)) &&
    !inverted &&
    patterns.length === 1 &&
    pattern.includes(worktree) &&
    !/[|()]/.test(pattern.split(worktree).join(''))
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
