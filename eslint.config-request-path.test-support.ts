import { assert, describe, test } from 'riteway/bun';
import { repositoryEslint } from './eslint.config.test-support';

export function registerRequestPathTests() {
  describe('route ids come from params, never the request path', () => {
    const lint = async (filePath: string, code: string) => {
      const [result] = await repositoryEslint().lintText(code, { filePath });
      return result!.messages
        .filter(({ ruleId }) => ruleId === 'request-path/by-params')
        .map(({ ruleId }) => ruleId);
    };

    test('refuses every spelling of splitting a request path in apps/web/src', async () => {
      // RECON-3.4: the ban held only under app/, so clubs, media capture and
      // the account route still split the path for their ids.
      const spellings = [
        "export const id = new URL(request.url).pathname.split('/')[3];",
        "export const id = url.pathname.split('/').at(-1);",
        "const { pathname } = new URL(request.url); export const id = pathname.split('/')[2];",
        "const { pathname: path } = request.nextUrl; export const parts = path.split('/');",
        'const path = request.nextUrl.pathname; export const parts = path.match(/[^/]+/g);',
        "export const parts = request.url.split('?');",
        'export const found = /\\/rounds\\/([^/]+)/.exec(url.pathname);',
        'export const parts = [...url.pathname.matchAll(/\\/(\\w+)/g)];',
        "export const id = url?.pathname.split('/')[1];",
        'export const rest = url.pathname.slice(7);',
        'export const rest = url.pathname.substring(7);',
        "export const rest = url.pathname.replace(/^\\/clubs\\//, '');",
        "export const found = 'x'.match(url.pathname);",
      ];
      const legal = [
        'export const room = /^\\/rooms\\/[^/]+$/.test(pathname);',
        "export const inside = pathname === '/clubs' || pathname.startsWith('/clubs/');",
        "const route = new URLPattern({ pathname: '/:id' }); export const id = route.exec(url)?.pathname.groups['id'];",
        "export const [club, invitation] = invitationParam.split('.');",
      ];
      assert({
        given:
          'each spelling in a feature, a server module, a route and a test',
        should: 'refuse each one',
        actual: await Promise.all([
          ...spellings.map((code) =>
            lint('apps/web/src/features/clubs/probe.ts', code),
          ),
          ...spellings.map((code) =>
            lint('apps/web/src/server/probe.ts', code),
          ),
          ...spellings.map((code) =>
            lint('apps/web/src/features/clubs/probe.test.ts', code),
          ),
          ...legal.map((code) => lint('apps/web/src/server/probe.ts', code)),
        ]),
        expected: [
          ...spellings.map(() => ['request-path/by-params']),
          ...spellings.map(() => ['request-path/by-params']),
          ...spellings.map(() => ['request-path/by-params']),
          ...legal.map(() => []),
        ],
      });
    });
  });
}
