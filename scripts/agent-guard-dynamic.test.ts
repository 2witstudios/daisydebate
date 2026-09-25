/**
 * Regression corpus for the fail-closed rule (ADR 0035, 2026-09-25
 * amendment): a command whose executable name the parser cannot resolve
 * statically — built from a variable or a command substitution — is
 * refused for an autonomous agent instead of silently falling through to
 * allow. This closes the residual gap the spelling-list era left open:
 * eval and shell -c of a dynamic value recurse into the same unresolved
 * name and are caught the same way.
 */
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decide, owner } from './agent-guard.test-support';

setupRitewayBun();

describe('agent guard: fails closed on an unresolved executable', () => {
  test('refuses a command substitution in the executable position', () => {
    assert({
      given: '$(...) and a backtick substitution naming the program',
      should: 'deny both for an autonomous agent',
      actual: [
        decide('$(echo git) push origin main'),
        decide('`git` push origin main'),
      ],
      expected: ['deny', 'deny'],
    });
  });

  test('refuses a variable naming the executable', () => {
    assert({
      given: 'a bare variable and a braced one in the executable position',
      should: 'deny both',
      actual: [decide('$CMD push origin main'), decide('${CMD} status')],
      expected: ['deny', 'deny'],
    });
  });

  test('refuses eval and shell -c of an unresolved value', () => {
    assert({
      given: 'eval "$CMD" and bash -c "$CMD"',
      should: 'deny both, since the guard cannot judge the resolved command',
      actual: [decide('eval "$CMD"'), decide('bash -c "$CMD"')],
      expected: ['deny', 'deny'],
    });
  });

  test('still allows a literal command inside eval and shell -c', () => {
    assert({
      given: 'eval and bash -c of a plain, harmless command',
      should: 'allow both',
      actual: [decide('eval "git status"'), decide(`bash -c 'git status'`)],
      expected: ['allow', 'allow'],
    });
  });

  test('leaves owner sessions unaffected', () => {
    assert({
      given: 'an owner session running a dynamically-named command',
      should: 'allow it',
      actual: decide('$CMD status', owner()),
      expected: 'allow',
    });
  });
});
