/**
 * The agent guard's slot rules (ADR 0035 on ADR 0034). Every checkout shares
 * one Compose stack; an agent owns only its slot's databases and Redis
 * namespace. So an autonomous agent never removes, stops or prunes
 * containers, volumes or the stack, and resets or drops only its own slot.
 */
import { otherKillers } from './agent-guard-process';
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

const SHARED_REASON =
  'The Compose stack is shared by every checkout (ADR 0034): an agent never stops, removes or prunes its containers or volumes. Manage your own slot with bun slot:up, slot:down or db:reset.';
const SLOT_REASON =
  'That reaches a slot this session does not own. Run db:reset and slot:down only from your own worktree, against its own databases.';

const composeDestructive = new Set(['down', 'rm', 'kill', 'stop', 'pause']);
const dockerDestructive = new Set(['rm', 'stop', 'kill', 'rmi', 'prune']);
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

/** The subcommand after compose's global options. */
function composeAction(args: readonly string[]): string {
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const [flag, inline] = splitFlag(args[index]);
    index += inline === undefined && composeValueOptions.has(flag) ? 2 : 1;
  }
  return args[index] ?? '';
}

// Docker's global options come before the subcommand and would hide it.
const DOCKER_VALUE_OPTIONS = new Set([
  '--context',
  '-c',
  '-H',
  '--host',
  '--config',
  '-l',
  '--log-level',
  '--tlscacert',
  '--tlscert',
  '--tlskey',
]);

function withoutGlobalOptions(words: readonly string[]): string[] {
  const [name = '', ...rest] = words;
  let index = 0;
  while (index < rest.length && rest[index].startsWith('-')) {
    const [flag, inline] = splitFlag(rest[index]);
    index += DOCKER_VALUE_OPTIONS.has(flag) && inline === undefined ? 2 : 1;
  }
  return [name, ...rest.slice(index)];
}

export const docker: Rule = (invocation, facts) => {
  if (!facts.autonomous) return allow;
  const [name, group = '', action = '', ...rest] =
    invocation.words[0] === 'docker'
      ? withoutGlobalOptions(invocation.words)
      : invocation.words;
  const composeArgs =
    name === 'docker-compose'
      ? [group, action, ...rest]
      : group === 'compose'
        ? [action, ...rest]
        : undefined;
  if (composeArgs)
    return composeDestructive.has(composeAction(composeArgs))
      ? deny(SHARED_REASON)
      : allow;
  return dockerDestructive.has(group) || dockerDestructive.has(action)
    ? deny(SHARED_REASON)
    : allow;
};

const SLOT_SCRIPTS = new Set([
  'db:reset',
  'scripts/db-reset.ts',
  'slot:up',
  'slot:down',
  'scripts/slot.ts',
]);
// scripts/slot.ts selects another checkout or .env file with these.
const TARGET_OPTIONS = new Set(['--checkout', '--env']);

/** Paths named by --checkout or --env, resolved against cwd. */
function targetPaths(args: readonly string[], cwd: string): string[] {
  const paths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const [flag, inline] = splitFlag(args[index]);
    if (!TARGET_OPTIONS.has(flag)) continue;
    paths.push(resolveFrom(cwd, inline ?? args[index + 1] ?? ''));
    if (inline === undefined) index += 1;
  }
  return paths;
}
const DATABASE_KEYS = ['DATABASE_URL', 'TEST_DATABASE_URL', 'E2E_DATABASE_URL'];

function databaseName(url: string): string | undefined {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return undefined;
  }
}

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

function ownsSlot(
  invocation: Invocation,
  facts: GuardFacts,
  dir: string,
  args: readonly string[],
) {
  const own = facts.databaseOf(facts.worktree);
  const hasSlot =
    own !== undefined && own !== facts.databaseOf(facts.mainCheckout);
  const overrides = DATABASE_KEYS.flatMap((key) => {
    const value = invocation.assignments[key];
    return value === undefined ? [] : [databaseName(value)];
  });
  return (
    hasSlot &&
    isWithin(dir, facts.worktree) &&
    targetPaths(args, dir).every((path) => isWithin(path, facts.worktree)) &&
    overrides.every((name) => name === own || name === `${own}_test`)
  );
}

export const bun: Rule = (invocation, facts, cwd): Verdict => {
  const { dir, script, args } = bunScript(invocation.words, cwd);
  // bun x <package> is bunx.
  if (script === 'x')
    return otherKillers(
      { ...invocation, words: ['bunx', ...args] },
      facts,
      cwd,
    );
  if (script === 'github:rules' && args.includes('--apply'))
    return autonomousOnly(facts, RULE_REASON);
  if (!facts.autonomous || !SLOT_SCRIPTS.has(script)) return allow;
  return ownsSlot(invocation, facts, dir, args) ? allow : deny(SLOT_REASON);
};
