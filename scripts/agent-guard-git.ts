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
export function expandLong(flag: string, options: readonly string[]): string {
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
