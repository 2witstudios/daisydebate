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
