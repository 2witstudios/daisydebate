/**
 * The agent guard's git rules (ADR 0035): pushes to protected branches and
 * anything that would skip the pre-push hook.
 */
import {
  allow,
  autonomousOnly,
  combine,
  MERGE_PATH,
  pushTargetVerdict,
  refuseOrAsk,
  resolveFrom,
  branchName,
  splitFlag,
  type GuardFacts,
  type Rule,
} from './agent-guard-rules';

// git push's long options. git accepts any unique prefix of a long option
// (--no-verif is --no-verify), so flags are expanded before they are judged.
const PUSH_LONG = [
  '--all',
  '--branches',
  '--mirror',
  '--tags',
  '--follow-tags',
  '--no-follow-tags',
  '--delete',
  '--prune',
  '--dry-run',
  '--porcelain',
  '--force',
  '--force-with-lease',
  '--no-force-with-lease',
  '--force-if-includes',
  '--no-force-if-includes',
  '--verify',
  '--no-verify',
  '--set-upstream',
  '--thin',
  '--no-thin',
  '--quiet',
  '--verbose',
  '--progress',
  '--no-progress',
  '--signed',
  '--no-signed',
  '--atomic',
  '--no-atomic',
  '--recurse-submodules',
  '--no-recurse-submodules',
  '--ipv4',
  '--ipv6',
  '--repo',
  '--push-option',
  '--receive-pack',
  '--exec',
];
const pushValueOptions = new Set([
  '--repo',
  '-o',
  '--push-option',
  '--receive-pack',
  '--exec',
]);

/** The long option git would read for an abbreviation, when unambiguous. */
function expandLong(flag: string, options: readonly string[]): string {
  if (options.includes(flag)) return flag;
  const matches = options.filter((option) => option.startsWith(flag));
  return matches.length === 1 ? matches[0] : flag;
}

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
    const [raw, inline] = splitFlag(arg);
    const flag = arg.startsWith('--') ? expandLong(raw, PUSH_LONG) : raw;
    if (!arg.startsWith('-')) positional.push(arg);
    else flags.add(flag === '-d' ? '--delete' : flag);
    if (pushValueOptions.has(flag) && inline === undefined) index += 1;
  }
  const current = facts.branchOf(dir);
  // With --repo the remote is named by the option, so every positional is a refspec.
  const refspecs = flags.has('--repo') ? positional : positional.slice(1);
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

const HOOKS_PATH = /core\.hookspath/i;
const HOOKS_REASON = 'Overriding core.hooksPath disables the pre-push guard.';
const CONFIG_REASON =
  'A one-shot git -c alias or include hides the command the guard would judge. Run the command itself.';

/** The verdict on one git -c key=value. */
function configVerdict(setting: string, facts: GuardFacts): Verdict {
  const at = setting.indexOf('=');
  const key = at === -1 ? setting : setting.slice(0, at);
  const value = at === -1 ? '' : setting.slice(at + 1);
  if (HOOKS_PATH.test(key)) return autonomousOnly(facts, HOOKS_REASON);
  if (/^(?:alias\.|include(?:if\..*)?\.path$)/i.test(key))
    return autonomousOnly(facts, CONFIG_REASON);
  // remote.<name>.push supplies the refspec a bare git push uses.
  if (/^remote\..*\.push$/i.test(key))
    return pushTargetVerdict(
      facts,
      branchName(value.replace(/^\+/, '').split(':').at(-1) ?? ''),
    );
  return allow;
}

// git's global options that take a value as the next word.
const GIT_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--config-env',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
]);

/** Whether the environment an invocation runs with points hooks elsewhere. */
const hooksPathInEnvironment = (
  assignments: Readonly<Record<string, string>>,
): boolean =>
  Object.entries(assignments).some(
    ([key, value]) =>
      (/^GIT_CONFIG_(?:KEY_\d+|PARAMETERS)$/.test(key) &&
        HOOKS_PATH.test(value)) ||
      (key === 'GIT_CONFIG_GLOBAL' && value !== ''),
  );

export const git: Rule = (invocation, facts, cwd) => {
  const [, ...rest] = invocation.words;
  let dir = cwd;
  const hooksOverride = hooksPathInEnvironment(invocation.assignments);
  const configs: Verdict[] = [];
  let index = 0;
  while (index < rest.length && rest[index].startsWith('-')) {
    const [flag, inline] = splitFlag(rest[index]);
    const value = inline ?? rest[index + 1] ?? '';
    if (flag === '-C') dir = resolveFrom(dir, value, facts.home);
    if (flag === '-c' || flag === '--config-env')
      configs.push(configVerdict(value, facts));
    index += GIT_VALUE_OPTIONS.has(flag) && inline === undefined ? 2 : 1;
  }
  const subcommand = rest[index];
  // git config core.hooksPath <path> persists the override.
  const setsHooks =
    subcommand === 'config' &&
    rest.slice(index + 1).some((arg) => HOOKS_PATH.test(arg));
  return combine([
    ...configs,
    hooksOverride || setsHooks ? autonomousOnly(facts, HOOKS_REASON) : allow,
    subcommand === 'push' ? gitPush(rest.slice(index + 1), facts, dir) : allow,
  ]);
};
