import { assert, describe, test } from 'riteway/bun';
import { repositoryEslint } from './eslint.config.test-support';

const ruleId = 'rendered-markup/through-roles';

export function registerRenderedMarkupTests() {
  describe('component tests read rendered output by role and name', () => {
    const lint = async (filePath: string, code: string) => {
      const [result] = await repositoryEslint().lintText(code, { filePath });
      return result!.messages.some((message) => message.ruleId === ruleId);
    };

    // RECON-4.8: 202 test files matched tags, attributes and class strings
    // in server-rendered HTML.
    const spellings = [
      "import { renderToString } from 'react-dom/server';",
      "import { renderToStaticMarkup as render } from 'react-dom/server';",
      "import * as server from 'react-dom/server';",
      "import server from 'react-dom/server.node';",
      "import { prerender } from 'react-dom/static';",
      "export { renderToString } from 'react-dom/server';",
      "export * from 'react-dom/server.browser';",
      "export const server = await import('react-dom/server');",
      'export const server = await import(`react-dom/server`);',
      "export const server = require('react-dom/server');",
      "export const path = Bun.resolveSync('react-dom/server', import.meta.dir);",
      "type Server = typeof import('react-dom/server');",
      "import { renderMarkup } from '../../test-support/rendered/markup';",
      "import { renderMarkup } from '@/test-support/rendered/markup.ts';",
      'export const html = container.innerHTML;',
      'export const html = container.outerHTML;',
      "export const html = container['innerHTML'];",
      'export const html = container[`outerHTML`];',
      "export const html = Reflect.get(container, 'innerHTML');",
      "const key = 'innerHTML'; export const html = container[key];",
      'export const { innerHTML } = container;',
      'export const html = container.getHTML();',
      'export const html = new XMLSerializer().serializeToString(container);',
      'export const html = container?.innerHTML.includes("<button");',
    ];
    const legal = [
      "import { renderAccessible } from '../../test-support/rendered/accessible';",
      "import { accessibleWithin } from '../../test-support/rendered/accessible';",
      "container.innerHTML = '<button>Save</button>';",
      "document.body['innerHTML'] = '<form></form>';",
      'export const text = container.textContent;',
    ];

    test('refuses every spelling in component tests and test support', async () => {
      const paths = [
        'apps/web/src/ui/rooms/probe.test.tsx',
        'apps/web/src/features/documents/probe.test.ts',
        'apps/web/src/ui/people/probe.test-support.tsx',
        'apps/web/src/ui/test-support/probe.ts',
        'apps/web/src/app/(bare)/probe.test.tsx',
      ];
      assert({
        given: 'each spelling in each kind of test file',
        should: 'refuse each one',
        actual: await Promise.all(
          paths.flatMap((path) => spellings.map((code) => lint(path, code))),
        ),
        expected: paths.flatMap(() => spellings.map(() => true)),
      });
    });

    test('allows role queries and a test writing its own DOM', async () => {
      assert({
        given: 'the role helper, an innerHTML write and text content',
        should: 'allow each one',
        actual: await Promise.all(
          legal.map((code) =>
            lint('apps/web/src/ui/rooms/probe.test.tsx', code),
          ),
        ),
        expected: legal.map(() => false),
      });
    });

    test('the home of rendered output and the markup contracts may render', async () => {
      const homes = [
        'apps/web/src/test-support/rendered/accessible.ts',
        'apps/web/src/test-support/rendered/markup.ts',
        'apps/web/src/markup-contracts/email-layout.test.tsx',
      ];
      assert({
        given: 'the helper folder and the markup-contracts folder',
        should: 'allow raw rendering there',
        actual: await Promise.all(
          homes.map((path) =>
            lint(
              path,
              "import { renderToStaticMarkup } from 'react-dom/server';",
            ),
          ),
        ),
        expected: homes.map(() => false),
      });
    });

    test('production code may render to a string', async () => {
      assert({
        given: 'a server module rendering an email',
        should: 'not apply the test rule',
        actual: await lint(
          'apps/web/src/features/mail/render.ts',
          "import { renderToStaticMarkup } from 'react-dom/server';",
        ),
        expected: false,
      });
    });
  });
}
