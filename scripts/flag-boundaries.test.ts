import { assert, setupRitewayBun, test } from 'riteway/bun';
import { flagBoundaryProblems } from './flag-boundaries';

setupRitewayBun();
test('server-only flag boundary follows indirect imports and re-exports', () => {
  const root = 'apps/web/src/';
  const sources = new Map([
    [`${root}features/flags/server.ts`, 'export const read = () => false;'],
    [`${root}lib/hidden.ts`, "export {read} from '../features/flags/server';"],
    [
      `${root}ui/client.ts`,
      "'use client'; import {read} from '../lib/hidden';",
    ],
    [`${root}proxy.ts`, "import {read} from './lib/hidden';"],
    [
      `${root}app/cached.ts`,
      "import {read} from '../lib/hidden'; export async function page(){'use cache'; return read();}",
    ],
    [`${root}app/page.ts`, "import {read} from '../features/flags/server';"],
    [`${root}lib/leaked.ts`, "export const key = 'premium-checkout';"],
    [
      `${root}ui/indirect-key.ts`,
      "'use client'; import {key} from '../lib/leaked';",
    ],
    [`${root}ui/template.ts`, "'use client'; const key = `premium-checkout`;"],
    [`${root}ui/literal.ts`, "'use client'; const key = 'premium-checkout';"],
    [
      `${root}ui/boolean.ts`,
      "'use client'; export const show = (available:boolean)=>available;",
    ],
    [
      `${root}ui/dynamic.ts`,
      "'use client'; const load = () => import('../lib/hidden');",
    ],
    [
      `${root}ui/template-import.ts`,
      "'use client'; const load = () => import(`../lib/hidden`);",
    ],
    [
      `${root}app/cached-js.ts`,
      "import {read} from '../lib/hidden.js'; export async function page(){'use cache'; return read();}",
    ],
  ]);
  assert({
    given:
      'client, proxy and cached scopes reaching flags through aliases/re-exports/dynamic imports, plus a leaked key',
    should: 'reject them while accepting a server page and plain UI boolean',
    actual: flagBoundaryProblems(sources, ['premium-checkout'])
      .map((issue) => issue.split(':')[0])
      .sort(),
    expected: [
      'app/cached.ts',
      'app/cached-js.ts',
      'ui/template-import.ts',
      'proxy.ts',
      'ui/client.ts',
      'ui/dynamic.ts',
      'ui/literal.ts',
      'ui/indirect-key.ts',
      'ui/template.ts',
    ]
      .map((path) => root + path)
      .sort(),
  });
});
