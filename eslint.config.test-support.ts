import { ESLint } from 'eslint';

// One instance for the whole file: building the typed-lint program is the
// expensive step, and under machine load it dominated every test. The lint
// scripts pass a load-tolerant --timeout instead of Bun's fixed 5 s.
let shared: ESLint | undefined;
export const repositoryEslint = (): ESLint =>
  (shared ??= new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: './eslint.config.mjs',
  }));

/** Each problem ESLint reports for `code` at `filePath`, with its severity. */
const problems = async (code: string, filePath: string) => {
  const [result] = await repositoryEslint().lintText(code, { filePath });
  return (result?.messages ?? []).map(({ ruleId, severity }) => ({
    ruleId,
    severity,
  }));
};
/** The rule id of each problem ESLint reports for `code` at `filePath`. */
const ruleIds = async (code: string, filePath: string) =>
  (await problems(code, filePath)).map(({ ruleId }) => ruleId);
export type Problems = readonly [
  code: string,
  filePath: string,
  errors: number,
];
export const table = (cases: readonly Problems[]) => ({
  actual: Promise.all(cases.map(([code, path]) => problems(code, path))),
  expected: cases.map(([, , errors]) =>
    Array(errors).fill({ ruleId: 'no-restricted-syntax', severity: 2 }),
  ),
});

export type Case = readonly [code: string, filePath: string, ruleIds: string[]];
export const outcomes = (cases: readonly Case[]) =>
  Promise.all(cases.map(([code, filePath]) => ruleIds(code, filePath)));
export const expectedOf = (cases: readonly Case[]) =>
  cases.map(([, , ids]) => ids);

export const web = (path: string) => `apps/web/src/${path}`;

/** Fixtures for the process-edge tests (ISSUE-7). */
export const [props, globals, imports] = [
  'properties',
  'globals',
  'imports',
].map((kind) => [`no-restricted-${kind}`]);
export const edgeImport = (from: string, name = 'processApp', ext = '') =>
  `import { ${name} } from '${from}process-app${ext}';\nexport const x = ${name};`;
export const reads =
  'export const env = process.env;\nexport const g = globalThis as unknown;';
export const mutations = [
  "process.env.FOUNDATION_PROOF_ENABLED = 'true';",
  'delete process.env.DATABASE_URL;',
  "Object.assign(process.env, { NODE_ENV: 'test' });",
  'globalThis.fetch = (async () => new Response()) as typeof fetch;',
  "Reflect.set(globalThis, 'daisyResources', {});",
  "Reflect.deleteProperty(process.env, 'PUBLIC_APP_URL');",
].join('\n');
export const sixMutations = Array.from(
  { length: 6 },
  () => 'no-restricted-syntax',
);
export const route = web('app/api/health/ready/route.ts');
export const lazyEdge = (path: string) =>
  `export const l = () => import('${path}');`;
const suite = 'apps/web/integration/leak.integration.ts';
export const e2eServer = 'apps/web/e2e/support/server.ts';
/** Every spelling that reaches the edge outside its entries (review 2). */
const computed = "export const l = import(`./${'process-app'}`);";
export const escapes: ReadonlyArray<readonly [string, string]> = [
  [edgeImport('../../server/', 'processApp', '.js'), web('features/x.ts')],
  [edgeImport('/repo/apps/web/src/server/', 'processApp', '.ts'), web('x.ts')],
  [lazyEdge('../../server/process-app'), web('features/x.ts')],
  [lazyEdge('../../server/process-app.js'), route],
  [computed, web('server/x.ts')],
  [edgeImport('../src/server/'), suite],
  [lazyEdge('../src/server/process-app'), suite],
  [edgeImport('../../src/server/'), 'apps/web/e2e/journey.e2e.ts'],
];
export const escapeRule = (code: string) =>
  code.startsWith('import {') ? imports : ['no-restricted-syntax'];
