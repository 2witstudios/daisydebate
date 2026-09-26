/**
 * Regression corpus for the two payload-hiding vectors the PR #113 review
 * found: find -exec/-execdir/-ok/-okdir hands the guard a program to run
 * without recursing into it, and xargs -I/-i/-J templates its command from
 * stdin, which the guard cannot see. Both let a payload only visible after
 * substitution slip past every rule.
 */
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decide, owner } from './agent-guard.test-support';

setupRitewayBun();

describe('agent guard: find -exec and friends', () => {
  test('recurses into the command find -exec, -execdir, -ok and -okdir would run', () => {
    assert({
      given: 'a push to main behind each of the four -exec-family actions',
      should: 'deny every one',
      actual: [
        decide(
          `find scripts -maxdepth 0 -exec bash -c "git push origin main" \\;`,
        ),
        decide(
          `find scripts -maxdepth 0 -execdir bash -c "git push origin main" \\;`,
        ),
        decide(`find scripts -maxdepth 0 -ok gh pr merge 1 --admin \\;`),
        decide(
          `find scripts -maxdepth 0 -okdir bash -c "git push origin main" \\;`,
        ),
      ],
      expected: Array(4).fill('deny'),
    });
  });

  test('still allows a read-only -exec', () => {
    assert({
      given: 'find -exec grep, unaffected by the recursion',
      should: 'allow it',
      actual: decide(`find . -name "*.ts" -exec grep -l foo {} +`),
      expected: 'allow',
    });
  });

  test('leaves owner sessions unaffected', () => {
    assert({
      given: 'an owner session running find -exec of a push to main',
      should: 'ask, the same as running the push directly would',
      actual: decide(
        `find scripts -maxdepth 0 -exec git push origin main \\;`,
        owner(),
      ),
      expected: 'ask',
    });
  });
});

describe('agent guard: xargs templating', () => {
  test('refuses xargs -I, -i and -J: the command they run is templated from stdin', () => {
    assert({
      given: 'the same idea in the GNU -I, legacy -i and BSD -J spellings',
      should: 'deny every one',
      actual: [
        decide('echo "git push origin main" | xargs -I{} bash -c "{}"'),
        decide('echo "git push origin main" | xargs -i bash -c "{}"'),
        decide('echo "git push origin main" | xargs -J% bash -c "%"'),
        decide('echo "git push origin main" | xargs --replace=% bash -c "%"'),
      ],
      expected: Array(4).fill('deny'),
    });
  });

  test('still allows xargs without templating', () => {
    assert({
      given: 'xargs appending stdin to a harmless command',
      should: 'allow it',
      actual: decide('find . -name "*.log" | xargs echo'),
      expected: 'allow',
    });
  });
});
