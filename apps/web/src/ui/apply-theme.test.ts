import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { applyTheme } from './apply-theme';

setupRitewayBun();

/** Hand-written stand-in for <html>: a plain object recording dataset writes. */
const createRoot = (dataset: Record<string, string | undefined> = {}) => ({
  dataset,
});

describe('applyTheme', () => {
  test('writes each theme onto the target', () => {
    const dark = createRoot();
    const light = createRoot();
    applyTheme(dark, 'dark');
    applyTheme(light, 'light');

    assert({
      given: 'each theme color',
      should: 'set data-theme to that same value',
      actual: [dark.dataset.theme, light.dataset.theme],
      expected: ['dark', 'light'],
    });
  });

  test('overwrites the server-rendered attribute when the theme switches', () => {
    const root = createRoot({ theme: 'dark' });
    applyTheme(root, 'light');
    const afterLight = root.dataset.theme;
    applyTheme(root, 'dark');

    assert({
      given: 'a target that shipped data-theme="dark" and two switches',
      should: 'hold the latest theme after each write',
      actual: [afterLight, root.dataset.theme],
      expected: ['light', 'dark'],
    });
  });

  test('touches nothing but the theme key', () => {
    const root = createRoot({ theme: 'dark', density: 'compact' });
    applyTheme(root, 'light');

    assert({
      given: 'a target carrying other data attributes',
      should: 'leave them as they were',
      actual: root.dataset,
      expected: { theme: 'light', density: 'compact' },
    });
  });
});
