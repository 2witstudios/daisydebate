/**
 * The agent guard's file rules (ADR 0035): loop state, the agent records in
 * .daisy and the guard's hook wiring are never changed by an agent by hand.
 * A path argument counts when it names a protected file, one of its parent
 * directories, or a glob that could expand to either.
 */
import { basename, dirname, join } from 'node:path';
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
  '.daisy/parent',
  '.daisy/role',
  // The guard's own wiring: an agent does not switch its checks off.
  '.claude/settings.json',
  '.githooks/pre-push',
];

// Every file and directory whose removal or rewrite reaches a protected file.
function protectedTargets(worktree: string): string[] {
  const targets = new Set<string>();
  for (const file of PROTECTED) {
    let path = join(worktree, file);
    while (path.length > worktree.length) {
      targets.add(path);
      path = dirname(path);
    }
  }
  targets.add(worktree);
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

/** Whether a path argument reaches a protected file, in any letter case. */
function reaches(arg: string, cwd: string, facts: GuardFacts): boolean {
  const path = resolveFrom(cwd, arg, facts.home);
  const files = PROTECTED.map((file) => join(facts.worktree, file));
  if (!GLOB.test(path))
    return files.some((file) =>
      isWithin(lower(file), lower(path.replace(/\/$/, ''))),
    );
  const pattern = globToRegExp(path);
  return protectedTargets(facts.worktree).some((target) =>
    pattern.test(target),
  );
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
function findActs(args: readonly string[], worktree: string): boolean {
  const writingExec = args.some(
    (arg, index) =>
      EXECS.includes(arg) && !READ_ONLY.has(args[index + 1] ?? ''),
  );
  if (writingExec) return true;
  if (!args.includes('-delete')) return false;
  // A -delete limited to names no protected path has cannot reach one.
  const names = findNames(args);
  const protectedNames = protectedTargets(worktree).map((path) =>
    basename(path),
  );
  return (
    names === undefined ||
    names.some((name) =>
      protectedNames.some((target) => globToRegExp(name).test(target)),
    )
  );
}

function findDeletes(
  args: readonly string[],
  worktree: string,
): readonly string[] {
  const acts = findActs(args, worktree);
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
function changedPaths(
  invocation: Invocation,
  worktree: string,
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
  if (name === 'find') return findDeletes(args, worktree);
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
    ...changedPaths(invocation, facts.worktree),
  ].some((path) => reaches(path, cwd, facts));
  return touched ? deny(LOOP_REASON) : allow;
}

/** Whether an edited file is loop state or an agent record. */
export const isProtectedFile = (path: string, facts: GuardFacts): boolean =>
  PROTECTED.some((file) => lower(path) === lower(join(facts.worktree, file)));
