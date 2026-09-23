/**
 * The agent guard's stack rules (ADR 0035): an autonomous agent may stop,
 * remove or reset only the Compose stack and database its own checkout
 * owns, never the owner's shared stack or another session's.
 */
import { dirname } from 'node:path';
import {
  allow,
  autonomousOnly,
  deny,
  isWithin,
  resolveFrom,
  RULE_REASON,
  splitFlag,
  type GuardFacts,
  type Invocation,
  type Rule,
  type Verdict,
} from './agent-guard-rules';

const STACK_REASON =
  'That reaches a Compose stack or database this session does not own. Manage only your own stack (the DAISY_STACK_NAME in your worktree .env); the shared stack belongs to the owner.';
function ownedStack(facts: GuardFacts): string | undefined {
  const mine = facts.stackOf(facts.worktree);
  return mine === facts.stackOf(facts.mainCheckout) ? undefined : mine;
}

const ownsName = (name: string, stack: string | undefined): boolean =>
  stack !== undefined &&
  (name === stack ||
    name.startsWith(`${stack}-`) ||
    name.startsWith(`${stack}_`));

const composeValueOptions = new Set([
  '-f',
  '--file',
  '-p',
  '--project-name',
  '--env-file',
  '--profile',
  '--project-directory',
  '--ansi',
  '--progress',
]);
const composeDestructive = new Set(['down', 'rm', 'kill', 'stop']);

function compose(
  args: readonly string[],
  invocation: Invocation,
  facts: GuardFacts,
  cwd: string,
): Verdict {
  const options: Record<string, string | undefined> = {};
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const [flag, inline] = splitFlag(args[index]);
    options[flag] = inline ?? args[index + 1];
    index += inline === undefined && composeValueOptions.has(flag) ? 2 : 1;
  }
  if (!composeDestructive.has(args[index] ?? '')) return allow;
  const envFile = options['--env-file'];
  const project =
    options['-p'] ??
    options['--project-name'] ??
    invocation.assignments.COMPOSE_PROJECT_NAME ??
    invocation.assignments.DAISY_STACK_NAME ??
    facts.stackOf(
      envFile ? dirname(resolveFrom(cwd, envFile)) : facts.mainCheckout,
    );
  return project === ownedStack(facts) ? allow : deny(STACK_REASON);
}

const dockerPrune = new Set([
  'system',
  'container',
  'volume',
  'network',
  'image',
  'builder',
]);
const dockerRemove = new Set(['rm', 'stop', 'kill', 'rmi']);
const dockerGroups = new Set(['volume', 'network', 'container']);

function dockerRemovals(
  rest: readonly string[],
): readonly string[] | undefined {
  const [group, action, ...args] = rest;
  if (dockerRemove.has(group ?? '')) return rest.slice(1);
  return dockerGroups.has(group ?? '') && dockerRemove.has(action ?? '')
    ? args
    : undefined;
}

export const docker: Rule = (invocation, facts, cwd) => {
  if (!facts.autonomous) return allow;
  const [name, ...rest] = invocation.words;
  if (name === 'docker-compose') return compose(rest, invocation, facts, cwd);
  const [group, action] = rest;
  if (group === 'compose')
    return compose(rest.slice(1), invocation, facts, cwd);
  if (dockerPrune.has(group ?? '') && action === 'prune')
    return deny(
      `docker ${group} prune removes every session's resources. ${STACK_REASON}`,
    );
  const removals = dockerRemovals(rest);
  if (!removals) return allow;
  const names = removals.filter((arg) => !arg.startsWith('-'));
  const stack = ownedStack(facts);
  return names.length > 0 && names.every((item) => ownsName(item, stack))
    ? allow
    : deny(STACK_REASON);
};

const RESET_SCRIPTS = new Set([
  'db:reset',
  'packages/db/scripts/reset.ts',
  'scripts/db-reset.ts',
]);
const DATABASE_OVERRIDES = [
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'DAISY_STACK_NAME',
  'DAISY_PG_PORT',
];

/** The script bun runs and the directory it runs in. */
function bunScript(words: readonly string[], cwd: string) {
  let dir = cwd;
  let index = 1;
  while (index < words.length) {
    const [flag, inline] = splitFlag(words[index]);
    if (flag === '--cwd') dir = resolveFrom(cwd, inline ?? words[index + 1]);
    if (flag === '--cwd' && inline === undefined) index += 2;
    else if (words[index] === 'run' || words[index].startsWith('-')) index += 1;
    else break;
  }
  return { dir, script: words[index] ?? '', args: words.slice(index + 1) };
}

function resetOwned(invocation: Invocation, facts: GuardFacts, dir: string) {
  const overridden = DATABASE_OVERRIDES.some(
    (key) => invocation.assignments[key] !== undefined,
  );
  const ownsDatabase =
    ownedStack(facts) !== undefined ||
    facts.databaseOf(facts.worktree) !== facts.databaseOf(facts.mainCheckout);
  return isWithin(dir, facts.worktree) && !overridden && ownsDatabase;
}

export const bun: Rule = (invocation, facts, cwd) => {
  const { dir, script, args } = bunScript(invocation.words, cwd);
  if (script === 'github:rules' && args.includes('--apply'))
    return autonomousOnly(facts, RULE_REASON);
  if (!facts.autonomous) return allow;
  if (script === 'infra:down') {
    const stack = invocation.assignments.DAISY_STACK_NAME ?? facts.stackOf(dir);
    return stack === ownedStack(facts) ? allow : deny(STACK_REASON);
  }
  if (RESET_SCRIPTS.has(script))
    return resetOwned(invocation, facts, dir) ? allow : deny(STACK_REASON);
  return allow;
};
