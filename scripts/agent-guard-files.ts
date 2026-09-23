/**
 * The agent guard's file rules (ADR 0035): loop state, the agent registry
 * in the main checkout and the guard's hook wiring are never changed by an
 * agent by hand. A path argument counts when it names a protected path,
 * anything inside the registry, one of their parent directories, or a glob
 * that could expand to any of those.
 */
import { basename, dirname, join } from 'node:path';
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

/**
 * A shell glob as a case-insensitive pattern (the disk is case-insensitive).
 * As in the shell, a segment starting with * or ? never matches a dotfile,
 * so rm -rf * leaves .claude alone.
 */
function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('/')
    .map((segment) => {
      const body = segment
        .replace(/[.+^${}()|\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replaceAll('\u0000', '.*');
      return /^[*?]/.test(segment) ? `(?!\\.)${body}` : body;
    })
    .join('/');
  return new RegExp(`^${source}$`, 'i');
}

const lower = (path: string) => path.toLowerCase();

/**
 * Whether a glob could name something inside dir: each of its leading
 * segments matches the dir's segment there (** matches the rest).
 */
function globInside(glob: string, dir: string): boolean {
  if (!GLOB.test(glob)) return false;
  const parts = glob.split('/');
  const dirParts = dir.split('/');
  if (parts.length <= dirParts.length && !parts.includes('**')) return false;
  for (const [index, part] of dirParts.entries()) {
    if (parts[index] === '**') return true;
    if (!globToRegExp(parts[index] ?? '').test(part)) return false;
  }
  return true;
}

/** Whether a path argument reaches a protected path, in any letter case. */
function reaches(arg: string, cwd: string, facts: GuardFacts): boolean {
  const path = resolveFrom(cwd, arg, facts.home);
  const registry = join(facts.mainCheckout, REGISTRY_DIR);
  const literal = GLOB.test(path) ? path.slice(0, path.search(GLOB)) : path;
  if (isWithin(lower(literal), lower(registry)) || globInside(path, registry))
    return true;
  if (!GLOB.test(path))
    return protectedPaths(facts).some(({ path: file }) =>
      isWithin(lower(file), lower(path.replace(/\/$/, ''))),
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

// An empty word (sed -i '' on macOS) names no path.
const operands = (args: readonly string[]) =>
  args.filter((arg) => arg !== '' && !arg.startsWith('-'));

// Commands find -exec may run without changing anything.
const READ_ONLY = new Set([
  'grep',
  'cat',
  'ls',
  'wc',
  'head',
  'tail',
  'file',
  'stat',
  'echo',
  'du',
  'diff',
  'shasum',
]);
const EXECS = ['-exec', '-execdir', '-ok', '-okdir'];

/** The names find matches (-name, -iname), or undefined when it matches by path. */
function findNames(args: readonly string[]): string[] | undefined {
  if (args.some((arg) => /^-i?(?:path|wholename|regex)$/.test(arg)))
    return undefined;
  const names = args.flatMap((arg, index) =>
    arg === '-name' || arg === '-iname' ? [args[index + 1] ?? ''] : [],
  );
  return names.length > 0 ? names : undefined;
}

/** Whether a find changes files: -delete, or an -exec of a writing command. */
function findActs(args: readonly string[], facts: GuardFacts): boolean {
  const writingExec = args.some(
    (arg, index) =>
      EXECS.includes(arg) && !READ_ONLY.has(args[index + 1] ?? ''),
  );
  if (writingExec) return true;
  if (!args.includes('-delete')) return false;
  // A -delete limited to names no protected path has cannot reach one.
  const names = findNames(args);
  const protectedNames = protectedTargets(facts).map((path) => basename(path));
  return (
    names === undefined ||
    names.some((name) =>
      protectedNames.some((target) => globToRegExp(name).test(target)),
    )
  );
}

function findDeletes(
  args: readonly string[],
  facts: GuardFacts,
  cwd: string,
): readonly string[] {
  const firstExpression = args.findIndex((arg) => /^[-(!]/.test(arg));
  const given = args.slice(
    0,
    firstExpression === -1 ? undefined : firstExpression,
  );
  const starts = given.length > 0 ? given : ['.'];
  // Registry records have no protected name, so a -delete that starts at,
  // inside or above the registry acts on it whatever -name says.
  const registry = lower(join(facts.mainCheckout, REGISTRY_DIR));
  const nearRegistry = starts.some((start) => {
    const path = lower(resolveFrom(cwd, start, facts.home));
    return isWithin(path, registry) || isWithin(registry, path);
  });
  const acts =
    findActs(args, facts) || (args.includes('-delete') && nearRegistry);
  return acts ? starts : [];
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
function changedPaths(
  invocation: Invocation,
  facts: GuardFacts,
  cwd: string,
): readonly string[] {
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
  if (name === 'find') return findDeletes(args, facts, cwd);
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
  const touched = [
    ...command.redirects,
    ...changedPaths(invocation, facts, cwd),
  ].some((path) => reaches(path, cwd, facts));
  return touched ? deny(LOOP_REASON) : allow;
}

/** Whether an edited file is loop state, guard wiring or in the registry. */
export const isProtectedFile = (path: string, facts: GuardFacts): boolean =>
  PROTECTED.some((file) => lower(path) === lower(join(facts.worktree, file))) ||
  isWithin(lower(path), lower(join(facts.mainCheckout, REGISTRY_DIR)));
