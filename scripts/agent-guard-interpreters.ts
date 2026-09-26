/**
 * The agent guard's interpreter rule (ADR 0035 amendment, review finding on
 * PR #113). A general-purpose interpreter given inline code on its command
 * line (`python -c`, `node -e`, `perl -e`, `ruby -e`, `php -r`, awk's own
 * program text, `osascript -e`) can run any operation this file guards, and
 * the guard does not understand that language well enough to classify what
 * the inline code does. That is unparseable with confidence, so it is
 * refused for an autonomous agent outright. Running the interpreter on a
 * script file is unaffected — the same parity `bash script.sh` already has
 * with the shell rules, since the guard does not read into a file either
 * way.
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
  splitFlag,
  type Rule,
} from './agent-guard-rules';

const INLINE_REASON =
  'This interpreter can run any operation the guard checks, from inline code the guard cannot read. Run the resolved command directly, or put the code in a reviewed script file.';

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

function hasInlineFlag(name: string, args: readonly string[]): boolean {
  const flags = INLINE_FLAGS[name];
  return (
    flags !== undefined && args.some((arg) => flags.has(splitFlag(arg)[0]))
  );
}

/** awk's program is its own first non-option operand unless -f reads one from a file. */
function awkIsInline(args: readonly string[]): boolean {
  for (const arg of args) {
    if (arg === '-f' || arg === '--file' || arg.startsWith('-f')) return false;
    if (!arg.startsWith('-')) return true;
  }
  return false;
}

export const interpreter: Rule = (invocation, facts) => {
  const [name = '', ...args] = invocation.words;
  const inline = name === 'awk' ? awkIsInline(args) : hasInlineFlag(name, args);
  return inline ? autonomousOnly(facts, INLINE_REASON) : allow;
};

const OPAQUE_REASON =
  'ssh and make are refused for an autonomous agent: ssh has no legitimate autonomous use here (git already runs with GIT_SSH_COMMAND=false), and make’s recipe lines are not visible on the command line for the guard to classify.';

export const opaque: Rule = (_invocation, facts) =>
  autonomousOnly(facts, OPAQUE_REASON);
