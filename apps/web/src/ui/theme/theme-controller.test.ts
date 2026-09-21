import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createThemeController, createTransition } from './theme-controller';
import type { ThemePreference } from './theme-preference';

setupRitewayBun();

/** Records every side effect in call order; the transition runs inline. */
const createRecorder = ({ secure = false } = {}) => {
  const calls: string[] = [];
  const controller = createThemeController({
    apply: (preference: ThemePreference) => calls.push(`apply ${preference}`),
    writeCookie: (cookie) => calls.push(`cookie ${cookie.split(';')[0]}`),
    broadcast: (preference) => calls.push(`broadcast ${preference}`),
    transition: (update) => {
      calls.push('transition');
      update();
    },
    secure,
  });
  return { calls, controller };
};

describe('createThemeController.select', () => {
  test('persists, applies inside a transition, then tells other tabs', () => {
    const { calls, controller } = createRecorder();
    controller.select('light');

    assert({
      given: 'the viewer choosing light',
      should: 'write the cookie, apply in a transition, and broadcast',
      actual: calls,
      expected: [
        'cookie daisy-theme=light',
        'transition',
        'apply light',
        'broadcast light',
      ],
    });
  });

  test('writes a Secure cookie over https', () => {
    const cookies: string[] = [];
    createThemeController({
      apply: () => {},
      writeCookie: (cookie) => cookies.push(cookie),
      broadcast: () => {},
      transition: (update) => update(),
      secure: true,
    }).select('system');

    assert({
      given: 'a secure origin',
      should: 'end the cookie with the Secure flag',
      actual: cookies.map((cookie) => cookie.endsWith('; Secure')),
      expected: [true],
    });
  });
});

describe('createThemeController.receive', () => {
  test('applies a preference broadcast by another tab', () => {
    const { calls, controller } = createRecorder();
    const received = controller.receive('system');

    assert({
      given: 'a valid preference from another tab',
      should: 'apply it without re-persisting or re-broadcasting',
      actual: { received, calls },
      expected: { received: 'system', calls: ['transition', 'apply system'] },
    });
  });

  test('ignores a message that is not a preference', () => {
    const { calls, controller } = createRecorder();
    const received = [controller.receive('sepia'), controller.receive({})];

    assert({
      given: 'untrusted channel messages carrying junk',
      should: 'ignore them and touch nothing',
      actual: { received, calls },
      expected: { received: [undefined, undefined], calls: [] },
    });
  });
});

describe('createTransition', () => {
  test('wraps the update in a view transition when motion is allowed', () => {
    const calls: string[] = [];
    createTransition({
      startViewTransition: (update) => {
        calls.push('view transition');
        update();
      },
      prefersReducedMotion: () => false,
    })(() => calls.push('update'));

    assert({
      given: 'view transition support and no reduced-motion preference',
      should: 'run the update inside the view transition',
      actual: calls,
      expected: ['view transition', 'update'],
    });
  });

  test('updates directly under reduced motion', () => {
    const calls: string[] = [];
    createTransition({
      startViewTransition: () => calls.push('view transition'),
      prefersReducedMotion: () => true,
    })(() => calls.push('update'));

    assert({
      given: 'a reduced-motion preference',
      should: 'skip the view transition',
      actual: calls,
      expected: ['update'],
    });
  });

  test('updates directly without view transition support', () => {
    const calls: string[] = [];
    createTransition({
      startViewTransition: undefined,
      prefersReducedMotion: () => false,
    })(() => calls.push('update'));

    assert({
      given: 'a browser without startViewTransition',
      should: 'run the update directly',
      actual: calls,
      expected: ['update'],
    });
  });
});
