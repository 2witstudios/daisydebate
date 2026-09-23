/**
 * The agent guard's file rules (ADR 0035): loop state, the agent registry
 * in the main checkout and the guard's hook wiring are never changed by an
 * agent by hand. A path argument counts when it names a protected path,
 * anything inside the registry, one of their parent directories, or a glob
 * that could expand to any of those.
 */
import { dirname, join } from 'node:path';
import { REGISTRY_DIR } from './agent-registry';
import type { ShellCommand } from './shell-command';
import {
  allow,
  deny,
  isWithin,
  LOOP_REASON,
  resolveFrom,
  type GuardFacts,
  type Invocation,
  type Verdict,
} from './agent-guard-rules';

const PROTECTED = [
  '.claude/ralph-loop.local.md',
  '.claude/ralph-loop.escalated.md',
  // The guard's own wiring: an agent does not switch its checks off.
  '.claude/settings.json',
  '.githooks/pre-push',
];

/** Protected paths, each with the checkout it belongs to. */
function protectedPaths(facts: GuardFacts) {
  return [
    ...PROTECTED.map((file) => ({
      path: join(facts.worktree, file),
      root: facts.worktree,
    })),
    // Registered parents and roles (agent-registry.ts), outside the worktree.
    {
      path: join(facts.mainCheckout, REGISTRY_DIR),
      root: facts.mainCheckout,
    },
  ];
}

// Every file and directory whose removal or rewrite reaches a protected path.
function protectedTargets(facts: GuardFacts): string[] {
  const targets = new Set<string>();
  for (const { path: start, root } of protectedPaths(facts)) {
    let path = start;
    while (path.length > root.length) {
      targets.add(path);
      path = dirname(path);
    }
    targets.add(root);
  }
  return [...targets];
}

const GLOB = /[*?[]/;

function globToRegExp(glob: string): RegExp {
  const source = glob
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${source}$`);
}

/** Whether a path argument reaches a protected path. */
function reaches(arg: string, cwd: string, facts: GuardFacts): boolean {
  const path = resolveFrom(cwd, arg);
  const registry = join(facts.mainCheckout, REGISTRY_DIR);
  const literal = GLOB.test(path) ? path.slice(0, path.search(GLOB)) : path;
  if (isWithin(literal, registry)) return true;
  if (!GLOB.test(path))
    return protectedPaths(facts).some(({ path: file }) =>
      isWithin(file, path.replace(/\/$/, '')),
    );
  const pattern = globToRegExp(path);
  return protectedTargets(facts).some((target) => pattern.test(target));
}

const removers = new Set([
  'rm',
  'rmdir',
  'mv',
  'unlink',
  'truncate',
  'tee',
  'shred',
  'touch',
]);
// These write only to their last argument.
const writers = new Set(['cp', 'ln', 'install']);

const operands = (args: readonly string[]) =>
  args.filter((arg) => !arg.startsWith('-'));

function findDeletes(args: readonly string[]): readonly string[] {
  const acts = args.some((arg) =>
    ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(arg),
  );
  const firstExpression = args.findIndex((arg) => /^[-(!]/.test(arg));
  const starts = args.slice(
    0,
    firstExpression === -1 ? undefined : firstExpression,
  );
  return acts ? (starts.length > 0 ? starts : ['.']) : [];
}

function gitCleans(args: readonly string[]): readonly string[] {
  // The subcommand is the first word after git's global options.
  let at = 0;
  while (at < args.length && args[at].startsWith('-'))
    at += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[at]) ? 2 : 1;
  if (args[at] !== 'clean') return [];
  const rest = args.slice(at + 1);
  if (rest.some((arg) => arg === '-n' || arg === '--dry-run')) return [];
  const paths = operands(rest.filter((arg) => arg !== '--'));
  return paths.length > 0 ? paths : ['.'];
}

/** The paths a command would change, for the commands that change files. */
function changedPaths(invocation: Invocation): readonly string[] {
  const [name = '', ...args] = invocation.words;
  if (removers.has(name)) return operands(args);
  if (writers.has(name)) return operands(args).slice(-1);
  if (name === 'dd')
    return args
      .filter((arg) => arg.startsWith('of='))
      .map((arg) => arg.slice(3));
  if (
    (name === 'sed' || name === 'perl') &&
    args.some((arg) => /^-[A-Za-z]*i/.test(arg))
  )
    return operands(args);
  if (name === 'find') return findDeletes(args);
  if (name === 'git') return gitCleans(args);
  return [];
}

export function loopState(
  command: ShellCommand,
  invocation: Invocation,
  facts: GuardFacts,
  cwd: string = facts.cwd,
): Verdict {
  if (!facts.autonomous) return allow;
  const touched = [...command.redirects, ...changedPaths(invocation)].some(
    (path) => reaches(path, cwd, facts),
  );
  return touched ? deny(LOOP_REASON) : allow;
}

/** Whether an edited file is loop state, guard wiring or in the registry. */
export const isProtectedFile = (path: string, facts: GuardFacts): boolean =>
  PROTECTED.some((file) => path === join(facts.worktree, file)) ||
  isWithin(path, join(facts.mainCheckout, REGISTRY_DIR));
