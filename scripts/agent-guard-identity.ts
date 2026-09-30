/**
 * The agent guard's identity rule (ADR 0035): a pu agent running without its
 * machine identity (resumed, or started outside the launcher) would act on
 * GitHub as the owner, so it never reaches GitHub until restarted.
 */
import {
  allow,
  autonomousOnly,
  type GuardFacts,
  deny,
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
  'A registered agent creates children only with `bun agent:spawn`, which registers each one in the main checkout; a raw pu spawn would mint an unregistered session that the guard and the board treat as the owner.';

/**
 * pu subcommands that create an agent (`spawn`, `swarm run`). Refused for a
 * registered agent so every session it creates is registered (ADR 0035).
 */
export const pu: Rule = (invocation, facts) => {
  const [, command = '', action = ''] = invocation.words;
  return command === 'spawn' || (command === 'swarm' && action === 'run')
    ? autonomousOnly(facts, PU_SPAWN_REASON)
    : allow;
};
