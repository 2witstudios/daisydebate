/**
 * The agent guard's interpreter rule (ADR 0035 §6a/6b, amended for ISSUE-138).
 * A general-purpose interpreter given inline code on its command line
 * (`python -c`, `node -e`, `perl -e`, `ruby -e`, `php -r`, awk's own program
 * text, `osascript -e`) can run any operation this file guards, and the
 * guard does not understand that language well enough to fully classify
 * what the inline code does. So it looks only for the small set of APIs
 * that could run a process or reach the network — `system(`, a piped
 * command, `child_process`, `Bun.spawn`, `subprocess`, `os.system`, `exec`,
 * `fetch`, … — and refuses only inline code that has one, per the owner's
 * DEC-12 stance that this guard is accident prevention, not a security
 * boundary, until GRD-6.2: a blanket refusal of every inline invocation
 * blocked ordinary read-only agent work (`awk '{print $2}'`, `bun -e`
 * generating a CSPRNG secret per `docs/operations/deploy-staging.md`,
 * `node -e`/`python3 -c` parsing JSON) more than it closed a real bypass.
 * Running the interpreter on a script file is unaffected — the same parity
 * `bash script.sh` already has with the shell rules — except awk's `-f`,
 * which reads the named file so it can be judged the same way as inline
 * code; a file the guard cannot read is refused, since it cannot be judged
 * safe either.
 *
 * `ssh` and `make` are refused outright, without an inline-code exception:
 * ADR 0035 already stops agent git from ever using SSH
 * (`GIT_SSH_COMMAND=false`), so a raw `ssh` invocation has no legitimate
 * autonomous use, and `make`'s recipe lines are never visible on the
 * command line for the guard to classify.
 */
import {
  allow,
  autonomousOnly,
  resolveFrom,
  splitFlag,
  type GuardFacts,
  type Rule,
} from './agent-guard-rules';

const INLINE_REASON =
  'This inline code can run a process or reach the network in a way the guard cannot verify (a shell command, a subprocess, or an outbound request). Run the resolved command directly, or put the code in a reviewed script file.';

const AWK_FILE_REASON =
  'This -f program file could not be read, so the guard cannot tell whether it runs a command. Run the resolved command directly, or make the file readable to the guard.';

const INLINE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  python: new Set(['-c']),
  python2: new Set(['-c']),
  python3: new Set(['-c']),
  node: new Set(['-e', '--eval', '-p', '--print']),
  nodejs: new Set(['-e', '--eval', '-p', '--print']),
  perl: new Set(['-e', '-E']),
  ruby: new Set(['-e']),
  php: new Set(['-r']),
  osascript: new Set(['-e']),
};

/**
 * The named process- and network-capable APIs an interpreter's inline code
 * could use to run any operation this file guards (ISSUE-138, DEC-12): a
 * named, bounded list, not a claim that every dangerous API in every
 * language is covered. Matched against the inline code text itself, never
 * against the interpreter's other arguments.
 */
const DANGEROUS_INLINE_APIS: readonly RegExp[] = [
  /\bsystem\s*\(/, // perl/ruby/php system("cmd"); python os.system(...)
  /\bpopen\s*\(/, // os.popen / IO.popen
  /\bsubprocess\b/, // python subprocess module
  /\bchild_process\b/, // node/bun require('child_process')
  /\bBun\.spawn(?:Sync)?\s*\(/, // bun
  /\bexec(?:Sync|File|FileSync)?\s*\(/, // node child_process.exec family
  /\bspawn(?:Sync)?\s*\(/, // node child_process.spawn family
  /do shell script/i, // osascript
  /\bfetch\s*\(/, // outbound network call
  /\brequire\(\s*['"]https?['"]\s*\)/, // node http/https module
  /\bhttp\.request\s*\(/,
  /\burllib\b/, // python urllib
  /\brequests\.(?:get|post|put|delete|patch)\s*\(/, // python requests library
];

/** Whether an interpreter's inline code has an API that could run a process or reach the network. */
export function hasDangerousInlineAPI(code: string): boolean {
  return DANGEROUS_INLINE_APIS.some((pattern) => pattern.test(code));
}

/** The pipe-to-command and command-execution forms awk's own grammar allows. */
const AWK_DANGEROUS: readonly RegExp[] = [
  /\bsystem\s*\(/, // system("cmd")
  /\|\s*"/, // print/printf … | "cmd"
  /"[^"]*"\s*\|\s*getline\b/, // "cmd" | getline
];

function awkProgramIsDangerous(text: string): boolean {
  return AWK_DANGEROUS.some((pattern) => pattern.test(text));
}

/** The single-letter switches of an inline-flag set (`-e` -> `e`), for reading a cluster. */
function singleLetters(flags: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(
    [...flags].filter((flag) => flag.length === 2).map((flag) => flag[1]),
  );
}

/**
 * The inline code text passed to one of an interpreter's inline-code flags
 * (`-e`, `--eval`, …), plain or clustered with other single-letter switches
 * the way Perl reads them (`-we`, `-pe`, `-wne`, …): every character after
 * the dash is its own switch, so any of them naming an inline-code flag
 * takes the next word as the code the same way the bare flag would.
 * `undefined` when the interpreter has no inline code on this line.
 */
function inlineCodeText(
  name: string,
  args: readonly string[],
): string | undefined {
  const flags = INLINE_FLAGS[name];
  if (flags === undefined) return undefined;
  const letters = singleLetters(flags);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inline] = splitFlag(arg);
    if (flags.has(flag)) return inline ?? args[index + 1];
    if (
      /^-[A-Za-z]+$/.test(arg) &&
      [...arg.slice(1)].some((letter) => letters.has(letter))
    )
      return args[index + 1];
  }
  return undefined;
}

type AwkSource =
  | { readonly kind: 'inline'; readonly text: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'none' };

/** awk's program is its own first non-option operand, unless -f/--file names one to read from a file. */
function awkSource(args: readonly string[]): AwkSource {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-f' || arg === '--file') {
      const path = args[index + 1];
      return path === undefined ? { kind: 'none' } : { kind: 'file', path };
    }
    if (arg.startsWith('--file='))
      return { kind: 'file', path: arg.slice('--file='.length) };
    if (arg.startsWith('-f')) return { kind: 'file', path: arg.slice(2) };
    if (!arg.startsWith('-')) return { kind: 'inline', text: arg };
  }
  return { kind: 'none' };
}

function awkVerdict(args: readonly string[], facts: GuardFacts, cwd: string) {
  const source = awkSource(args);
  if (source.kind === 'none') return allow;
  if (source.kind === 'inline')
    return awkProgramIsDangerous(source.text)
      ? autonomousOnly(facts, INLINE_REASON)
      : allow;
  const content = facts.readFile?.(resolveFrom(cwd, source.path, facts.home));
  if (content === undefined) return autonomousOnly(facts, AWK_FILE_REASON);
  return awkProgramIsDangerous(content)
    ? autonomousOnly(facts, INLINE_REASON)
    : allow;
}

// python3.11, python3.12, ruby3.2, perl5.34, php8.2, … (Homebrew, pyenv and
// system package managers all install these) read the same inline-code
// flags as their unversioned name.
const VERSIONED_NAME = /^(python|ruby|perl|php)\d+(?:\.\d+)*$/;

/** The name to look inline flags up by: a version suffix reads the same flags as the plain interpreter. */
export function canonicalInterpreterName(name: string): string {
  const match = VERSIONED_NAME.exec(name);
  return match ? match[1] : name;
}

export const interpreter: Rule = (invocation, facts, cwd) => {
  const [rawName = '', ...args] = invocation.words;
  const name = canonicalInterpreterName(rawName);
  if (name === 'awk') return awkVerdict(args, facts, cwd);
  const code = inlineCodeText(name, args);
  if (code === undefined) return allow;
  return hasDangerousInlineAPI(code)
    ? autonomousOnly(facts, INLINE_REASON)
    : allow;
};

const OPAQUE_REASON =
  'ssh and make are refused for an autonomous agent: ssh has no legitimate autonomous use here (git already runs with GIT_SSH_COMMAND=false), and make’s recipe lines are not visible on the command line for the guard to classify.';

export const opaque: Rule = (_invocation, facts) =>
  autonomousOnly(facts, OPAQUE_REASON);
