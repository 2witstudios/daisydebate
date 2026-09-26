/**
 * Regression corpus for the interpreter rule (ADR 0035 §6a/6b/6c amendment,
 * review finding on PR #113, ISSUE-138): a general-purpose interpreter given
 * inline code can run any operation the guard checks, and the guard cannot
 * fully read that language, so it looks only for the named process- and
 * network-capable APIs (ISSUE-138). Verified directly against the PR #113
 * review's four demonstrated bypass categories (a push to main, an admin
 * merge, an unscoped kill, and shared-stack teardown), each run through a
 * different interpreter, and against ISSUE-138's read-only false positives
 * (`awk '{print $2}'`, `bun -e` generating a CSPRNG secret, `node -e`/
 * `python3 -c` parsing JSON).
 */
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decide, facts, owner } from './agent-guard.test-support';

setupRitewayBun();

describe('agent guard: interpreters given inline code', () => {
  test('refuses a push to main through python, node, perl, ruby, awk and osascript', () => {
    assert({
      given: 'the same push, run as inline code in six interpreters',
      should: 'deny every one',
      actual: [
        decide(
          `python3 -c "import subprocess; subprocess.run(['git','push','origin','main'])"`,
        ),
        decide(
          `node -e "require('child_process').execSync('git push origin main')"`,
        ),
        decide(`perl -e 'system("git push origin main")'`),
        decide(`ruby -e 'system("git push origin main")'`),
        decide(`awk 'BEGIN{system("git push origin main")}'`),
        decide(`osascript -e 'do shell script "git push origin main"'`),
      ],
      expected: Array(6).fill('deny'),
    });
  });

  test('refuses an admin merge, an unscoped kill and shared-stack teardown through an interpreter', () => {
    assert({
      given:
        'python running gh pr merge --admin, perl running pkill -9 -f node, and python running docker compose down -v',
      should: 'deny each one, the same as running it directly would',
      actual: [
        decide(
          `python3 -c "import subprocess; subprocess.run(['gh','pr','merge','1','--admin'])"`,
        ),
        decide(`perl -e 'system("pkill -9 -f node")'`),
        decide(`python3 -c "import os; os.system('docker compose down -v')"`),
      ],
      expected: Array(3).fill('deny'),
    });
  });

  test('reads clustered perl switches (CodeRabbit finding on PR #113)', () => {
    assert({
      given:
        '-we, -pe and -wne, where -e clusters with other single-letter switches',
      should: 'deny each one, the same as bare -e',
      actual: [
        decide(`perl -we 'system("git push origin main")'`),
        decide(`perl -pe 'system("git push origin main")'`),
        decide(`perl -wne 'system("git push origin main")'`),
      ],
      expected: Array(3).fill('deny'),
    });
  });

  test('reads version-suffixed interpreter binaries the same way (CodeRabbit finding on PR #113)', () => {
    assert({
      given:
        'python3.11, python3.12, ruby3.2 and perl5.34, common Homebrew/pyenv/system binaries',
      should: 'deny each one, the same as the unversioned name',
      actual: [
        decide(`python3.11 -c "import os; os.system('git push origin main')"`),
        decide(`python3.12 -c "import os; os.system('git push origin main')"`),
        decide(`ruby3.2 -e 'system("git push origin main")'`),
        decide(`perl5.34 -e 'system("git push origin main")'`),
      ],
      expected: Array(4).fill('deny'),
    });
  });

  test('reads php -r, node --eval and node -p the same way', () => {
    assert({
      given: 'the other inline-eval spellings',
      should: 'deny each one',
      actual: [
        decide(`php -r 'system("git push origin main");'`),
        decide(
          `node --eval "require('child_process').execSync('git push origin main')"`,
        ),
        decide(
          `node -p "require('child_process').execSync('git push origin main')"`,
        ),
      ],
      expected: Array(3).fill('deny'),
    });
  });

  test('still allows an interpreter running a script file', () => {
    assert({
      given: 'python and node given a file argument instead of inline code',
      should: 'allow each one, the same parity a shell script file has',
      actual: [
        decide('python3 scripts/tool.py'),
        decide('node scripts/tool.js'),
      ],
      expected: Array(2).fill('allow'),
    });
  });

  test('allows inline code that has no process or network API (ISSUE-138: node -e/python3 -c parsing JSON)', () => {
    assert({
      given: 'node -e and python3 -c doing pure computation and JSON parsing',
      should: 'allow both: there is no process or network call to hide',
      actual: [
        decide(`node -e "console.log(1 + 1)"`),
        decide(`python3 -c "import json,sys; print(json.load(sys.stdin))"`),
      ],
      expected: Array(2).fill('allow'),
    });
  });

  test('still refuses inline code that reaches the network', () => {
    assert({
      given: "node -e calling fetch and python3 -c using Python's requests",
      should: 'deny both: the guard cannot verify the destination or payload',
      actual: [
        decide(`node -e "fetch('https://example.com')"`),
        decide(
          `python3 -c "import requests; requests.post('https://example.com')"`,
        ),
      ],
      expected: Array(2).fill('deny'),
    });
  });

  test('leaves owner sessions unaffected', () => {
    assert({
      given: 'an owner session running python -c',
      should: 'allow it',
      actual: decide(`python3 -c "print(1)"`, owner()),
      expected: 'allow',
    });
  });
});

describe('agent guard: awk given inline code (ISSUE-138)', () => {
  test('allows a program that cannot execute a command', () => {
    assert({
      given: "awk '{print $2}'",
      should: 'allow it: it has no system(), piped command or getline from one',
      actual: decide(`awk '{print $2}'`),
      expected: 'allow',
    });
  });

  test('still refuses system(), a piped command and getline from a command', () => {
    assert({
      given: 'system(), print piped to a shell, and getline reading from one',
      should: 'deny each: all three can run an arbitrary command',
      actual: [
        decide(`awk 'BEGIN{system("git push origin main")}'`),
        decide(`awk '{print $1 | "sh"}'`),
        decide(`awk 'BEGIN{"git log -1" | getline line; print line}'`),
      ],
      expected: Array(3).fill('deny'),
    });
  });

  test('refuses a variable piped to or from a command, not just a literal quoted one (PR #117 review)', () => {
    assert({
      given:
        'a command built into a variable, then piped out with print or in with getline',
      should:
        'deny both: awk has no bitwise-or, so any lone | outside a string or regex is a pipe to or from a command',
      actual: [
        decide(`awk 'BEGIN{c="git push origin main"; print $0 | c}'`),
        decide(`awk 'BEGIN{c="git push origin main"; c | getline}'`),
      ],
      expected: Array(2).fill('deny'),
    });
  });

  test('refuses a variable pipe even after a comment with an odd number of quotes, on the next line (PR #117 review round 2)', () => {
    assert({
      given:
        'a standalone comment containing one double quote, then a real command pipe on the next line',
      should:
        'deny it: the odd quote in the comment must not flip the scanner into a string state that swallows the following pipe',
      actual: decide(
        `awk '# note: says "hello\nBEGIN{c="git push origin main"; print $0 | c}'`,
      ),
      expected: 'deny',
    });
  });

  test('refuses a variable pipe after a trailing comment with an odd quote, in the same multi-line program (PR #117 review round 2)', () => {
    assert({
      given:
        'a line of code followed by a trailing comment with one double quote, then the pipe on the next line of the same program',
      should:
        'deny it, the same as the standalone-comment case: the trailing comment must not leak an open string into the rest of the program',
      actual: decide(
        `awk 'BEGIN{\nc="git push origin main" # comment with an odd quote here: "\nprint $0 | c\n}'`,
      ),
      expected: 'deny',
    });
  });

  test('refuses a pipe on the line after a comment ending in a trailing backslash', () => {
    assert({
      given:
        'a comment whose last character is \\ (not an escape in a comment), then a real command pipe on the next line',
      should:
        "deny it: a comment's trailing backslash must not be read as continuing the comment onto the next line",
      actual: decide(
        `awk '# a trailing backslash\\\nBEGIN{c="git push origin main"; print $0 | c}'`,
      ),
      expected: 'deny',
    });
  });

  test('allows logical || and a | inside a string or regex literal (PR #117 review)', () => {
    assert({
      given:
        'a logical-or comparison and a | that belongs to a string or regex, not a pipe',
      should: 'allow all three: none of them names a command pipe',
      actual: [
        decide(`awk 'NR>1 || $3=="x"'`),
        decide(`awk '/a|b/'`),
        decide(`awk 'BEGIN{print "a|b"}'`),
      ],
      expected: Array(3).fill('allow'),
    });
  });

  test('allows a -f program file the guard can read and judges safe', () => {
    assert({
      given: '-f naming a field-printing program the guard can read',
      should: 'allow it, the same as if it were inline',
      actual: decide(
        'awk -f scripts/tool.awk data.txt',
        facts({
          readFile: (path) =>
            path.endsWith('scripts/tool.awk') ? '{print $2}' : undefined,
        }),
      ),
      expected: 'allow',
    });
  });

  test('refuses a -f program file the guard cannot read', () => {
    assert({
      given: '-f naming a file the guard has no way to read',
      should: 'deny it: an unreadable program cannot be judged safe',
      actual: decide('awk -f scripts/tool.awk data.txt'),
      expected: 'deny',
    });
  });

  test('refuses a -f program file that is readable but can run a command', () => {
    assert({
      given: '-f naming a file whose program calls system()',
      should: 'deny it, the same as the identical inline program',
      actual: decide(
        'awk -f scripts/tool.awk',
        facts({
          readFile: (path) =>
            path.endsWith('scripts/tool.awk')
              ? 'BEGIN{system("git push origin main")}'
              : undefined,
        }),
      ),
      expected: 'deny',
    });
  });

  test('leaves owner sessions unaffected', () => {
    assert({
      given: 'an owner session running an awk program with system()',
      should: 'allow it',
      actual: decide(`awk 'BEGIN{system("git push origin main")}'`, owner()),
      expected: 'allow',
    });
  });
});

describe('agent guard: ssh and make', () => {
  test('refuses ssh and make for an autonomous agent', () => {
    assert({
      given:
        'ssh running a remote command and make reading a recipe from stdin',
      should: 'deny both',
      actual: [
        decide(`ssh localhost 'git push origin main'`),
        decide('make -f /dev/stdin'),
      ],
      expected: ['deny', 'deny'],
    });
  });

  test('leaves owner sessions free to use ssh and make', () => {
    assert({
      given: 'an owner session running ssh',
      should: 'allow it',
      actual: decide('ssh localhost uptime', owner()),
      expected: 'allow',
    });
  });
});

describe('agent guard: bun given inline code', () => {
  test('refuses bun -e/--eval/-p when the inline code can run a process or reach the network', () => {
    assert({
      given: 'inline code using child_process, Bun.spawn and fetch',
      should: 'deny each one',
      actual: [
        decide(
          `bun -e "require('child_process').execSync('git push origin main')"`,
        ),
        decide(`bun --eval "Bun.spawnSync(['git','push','origin','main'])"`),
        decide(`bun -p "fetch('https://example.com')"`),
      ],
      expected: Array(3).fill('deny'),
    });
  });

  test('allows bun -e/--eval/-p when the inline code cannot run a process (ISSUE-138: CSPRNG generation, docs/operations/deploy-staging.md)', () => {
    assert({
      given: 'bun -e generating a CSPRNG secret, and harmless literals',
      should: 'allow all three: there is no process or network call to hide',
      actual: [
        decide(
          `bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'))"`,
        ),
        decide(`bun --eval "1"`),
        decide(`bun -p "1"`),
      ],
      expected: Array(3).fill('allow'),
    });
  });

  test('does not treat a script’s own passthrough arguments as bun’s eval flags (CodeRabbit finding on PR #113)', () => {
    assert({
      given: '-e and -p passed after -- to the script itself, not to bun',
      should: 'allow both: those flags belong to the script, not bun',
      actual: [
        decide('bun run dev -- -e should-not-trigger'),
        decide('bun test -- -p nope'),
      ],
      expected: ['allow', 'allow'],
    });
  });

  test('still allows running a bun script normally', () => {
    assert({
      given:
        'bun run db:reset on its own slot, unaffected by the inline-eval check',
      should: 'allow it',
      actual: decide('bun run db:reset'),
      expected: 'allow',
    });
  });
});
