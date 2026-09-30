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
