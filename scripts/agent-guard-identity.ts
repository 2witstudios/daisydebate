/**
 * The agent guard's identity rule (ADR 0035): a pu agent running without its
 * machine identity (resumed, or started outside the launcher) would act on
 * GitHub as the owner, so it never reaches GitHub until restarted.
 */
import {
  allow,
  autonomousOnly,
  deny,
  type GuardFacts,
  type Rule,
  type Verdict,
} from './agent-guard-rules';

export const IDENTITY_REASON =
  'This pu agent runs without its machine identity (resumed, or started outside scripts/agent-launch.sh), so git and gh would act as the owner. Network git and gh are refused until it is restarted through the launcher.';
const NETWORK_GIT = new Set([
  'push',
  'fetch',
  'pull',
  'clone',
  'ls-remote',
  'remote',
  'submodule',
  'send-pack',
  'fetch-pack',
  'http-push',
]);

/** git's subcommand after its global options. */
function gitSubcommand(args: readonly string[]): string | undefined {
  let index = 0;
  while (index < args.length && args[index].startsWith('-'))
    index += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[index])
      ? 2
      : 1;
  return args[index];
}

/** A misconfigured agent never reaches GitHub, whatever the command. */
export function identityVerdict(
  name: string,
  args: readonly string[],
  facts: GuardFacts,
): Verdict {
  const subcommand = name === 'git' ? gitSubcommand(args) : undefined;
  const network =
    name === 'gh' ||
    NETWORK_GIT.has(subcommand ?? '') ||
    (subcommand === 'archive' &&
      args.some((arg) => arg.startsWith('--remote')));
  return facts.misconfigured && network ? deny(IDENTITY_REASON) : allow;
}

const PU_SPAWN_REASON =
  'A registered agent creates children only with `bun agent:spawn`, which registers each one; pu spawn, swarm run, schedule and trigger would mint an unregistered session that the guard and the board treat as the owner.';

// pu subcommands that create or start an agent session (schedules run
// agent definitions, swarms or prompts; a trigger assigned to an idle agent
// drives it), keyed by the action that does so.
const SESSION_MAKERS: Readonly<Record<string, ReadonlySet<string> | true>> = {
  spawn: true,
  swarm: new Set(['run']),
  schedule: new Set(['create', 'enable']),
  trigger: new Set(['create', 'assign']),
};

export const pu: Rule = (invocation, facts) => {
  const [, command = '', action = ''] = invocation.words;
  const makers = SESSION_MAKERS[command];
  return makers === true || makers?.has(action)
    ? autonomousOnly(facts, PU_SPAWN_REASON)
    : allow;
};
