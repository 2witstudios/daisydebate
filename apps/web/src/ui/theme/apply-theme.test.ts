import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { applyTheme } from './apply-theme';

setupRitewayBun();

const createMeta = (attributes: Record<string, string>) => ({
  attributes: { ...attributes },
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  },
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  },
});

const lightQuery = '(prefers-color-scheme: light)';
const darkQuery = '(prefers-color-scheme: dark)';

/**
 * Hand-written stand-in for `document`: records dataset writes on <html>
 * and serves the theme-color metas the server rendered. Selectors are
 * recorded so the test can prove only theme-color metas are queried.
 */
const createDocument = (dataset: Record<string, string | undefined> = {}) => {
  const metas = [
    createMeta({ name: 'theme-color', media: lightQuery, content: '#0a0e0c' }),
    createMeta({ name: 'theme-color', media: darkQuery, content: '#0a0e0c' }),
  ];
  const selectors: string[] = [];
  return {
    metas,
    selectors,
    documentElement: { dataset },
    querySelectorAll: (selector: string) => {
      selectors.push(selector);
      return metas;
    },
  };
};

describe('applyTheme', () => {
  test('writes each preference onto <html>', () => {
    const preferences = ['dark', 'light', 'system'] as const;
    const themes = preferences.map((preference) => {
      const doc = createDocument();
      applyTheme(doc, preference);
      return doc.documentElement.dataset.theme;
    });

    assert({
      given: 'each theme preference',
      should: 'set data-theme to that same value',
      actual: themes,
      expected: ['dark', 'light', 'system'],
    });
  });

  test('touches nothing but the theme key', () => {
    const doc = createDocument({ theme: 'dark', density: 'compact' });
    applyTheme(doc, 'light');

    assert({
      given: '<html> carrying other data attributes',
      should: 'leave them as they were',
      actual: doc.documentElement.dataset,
      expected: { theme: 'light', density: 'compact' },
    });
  });

  test('repaints the theme-color metas in place', () => {
    const doc = createDocument({ theme: 'dark' });
    applyTheme(doc, 'light');

    assert({
      given: 'dark theme-color metas and a switch to light',
      should: 'query only theme-color metas and paint both light',
      actual: {
        selectors: doc.selectors,
        metas: doc.metas.map((meta) => meta.attributes),
      },
      expected: {
        selectors: ['meta[name="theme-color"]'],
        metas: [
          { name: 'theme-color', media: lightQuery, content: '#f2f5f2' },
          { name: 'theme-color', media: darkQuery, content: '#f2f5f2' },
        ],
      },
    });
  });

  test('splits the metas by OS scheme for the system preference', () => {
    const doc = createDocument({ theme: 'dark' });
    applyTheme(doc, 'system');

    assert({
      given: 'a switch to the system preference',
      should: 'give each prefers-color-scheme meta its own color',
      actual: doc.metas.map((meta) => meta.attributes.content),
      expected: ['#f2f5f2', '#0a0e0c'],
    });
  });

  test('leaves a meta it does not recognize alone', () => {
    const doc = createDocument();
    const stray = createMeta({ name: 'theme-color', content: '#123456' });
    applyTheme({ ...doc, querySelectorAll: () => [stray] }, 'light');

    assert({
      given: 'a theme-color meta without a known media query',
      should: 'keep its content unchanged',
      actual: stray.attributes.content,
      expected: '#123456',
    });
  });
});
