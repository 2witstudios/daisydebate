/**
 * Regression corpus for the interpreter rule (ADR 0035 amendment, review
 * finding on PR #113): a general-purpose interpreter given inline code can
 * run any operation the guard checks, and the guard cannot read that
 * language well enough to judge what the code does. Verified directly
 * against the PR #113 review's four demonstrated bypass categories (a push
 * to main, an admin merge, an unscoped kill, and shared-stack teardown),
 * each run through a different interpreter.
 */
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decide, owner } from './agent-guard.test-support';

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
      given:
        'python, node and awk given a file argument instead of inline code',
      should: 'allow each one, the same parity a shell script file has',
      actual: [
        decide('python3 scripts/tool.py'),
        decide('node scripts/tool.js'),
        decide('awk -f scripts/tool.awk data.txt'),
      ],
      expected: Array(3).fill('allow'),
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
  test('refuses bun -e, --eval and -p the same as any other interpreter', () => {
    assert({
      given: 'bun -e, bun --eval and bun -p running inline code',
      should: 'deny each one',
      actual: [
        decide(
          `bun -e "require('child_process').execSync('git push origin main')"`,
        ),
        decide(`bun --eval "1"`),
        decide(`bun -p "1"`),
      ],
      expected: Array(3).fill('deny'),
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
