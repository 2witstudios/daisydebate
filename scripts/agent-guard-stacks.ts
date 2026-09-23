/**
 * The agent guard's slot rules (ADR 0035 on ADR 0034). Every checkout shares
 * one Compose stack; an agent owns only its slot's databases and Redis
 * namespace. So an autonomous agent never removes, stops or prunes
 * containers, volumes or the stack, and resets or drops only its own slot.
 */
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

export const docker: Rule = (invocation, facts) => {
  if (!facts.autonomous) return allow;
  const [name, group = '', action = '', ...rest] = invocation.words;
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

const SLOT_SCRIPTS: Readonly<Record<string, 'reset' | 'down'>> = {
  'db:reset': 'reset',
  'scripts/db-reset.ts': 'reset',
  'slot:down': 'down',
};
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

function ownsSlot(invocation: Invocation, facts: GuardFacts, dir: string) {
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
    overrides.every((name) => name === own || name === `${own}_test`)
  );
}

export const bun: Rule = (invocation, facts, cwd): Verdict => {
  const { dir, script, args } = bunScript(invocation.words, cwd);
  if (script === 'github:rules' && args.includes('--apply'))
    return autonomousOnly(facts, RULE_REASON);
  if (!facts.autonomous || !SLOT_SCRIPTS[script]) return allow;
  return ownsSlot(invocation, facts, dir) ? allow : deny(SLOT_REASON);
};
