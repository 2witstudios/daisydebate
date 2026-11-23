/**
 * Counts React effect call sites in the web app outside `ui/edge`, by any
 * name (RECON-3.7). Each call is resolved by the TypeScript checker to the
 * signature it invokes, so an import alias, a namespace member, a
 * destructured binding or a re-export from any module, the edge included,
 * all land on React's own `useEffect`, `useLayoutEffect` or
 * `useInsertionEffect` declaration and are counted.
 *
 *   bun scripts/count-effects.ts          # prints each site and the total
 *   bun scripts/count-effects.ts --check  # exits 1 when the total is not 0
 */
import { relative, resolve } from 'node:path';
import ts from 'typescript';

const effectHooks = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);

export type EffectSite = {
  readonly file: string;
  readonly line: number;
  readonly hook: string;
  readonly spelled: string;
};

const isReactDeclaration = (declaration: ts.Declaration | undefined) =>
  declaration !== undefined &&
  /[\\/]@types[\\/]react[\\/]/.test(declaration.getSourceFile().fileName);

const declaredName = (declaration: ts.Declaration): string | undefined =>
  ts.isFunctionDeclaration(declaration) && declaration.name
    ? declaration.name.text
    : undefined;

/** Every effect call in `files` that resolves to one of React's effect hooks. */
export function effectSites(
  program: ts.Program,
  files: readonly ts.SourceFile[],
  root: string,
): EffectSite[] {
  const checker = program.getTypeChecker();
  const sites: EffectSite[] = [];
  for (const file of files) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const declaration = checker.getResolvedSignature(node)?.declaration;
        const name =
          declaration && !ts.isJSDocSignature(declaration)
            ? declaredName(declaration)
            : undefined;
        if (
          name !== undefined &&
          effectHooks.has(name) &&
          isReactDeclaration(declaration)
        )
          sites.push({
            file: relative(root, file.fileName),
            line:
              file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            hook: name,
            spelled: node.expression.getText(file),
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return sites;
}

const outsideEdge = (fileName: string) =>
  !/[\\/]src[\\/]ui[\\/]edge[\\/]/.test(fileName);

/** The web app's program, read from its own tsconfig. */
export function webProgram(root: string): ts.Program {
  const configPath = resolve(root, 'apps/web/tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    resolve(root, 'apps/web'),
  );
  return ts.createProgram({
    rootNames: parsed.fileNames.filter((name) =>
      /[\\/]apps[\\/]web[\\/]src[\\/]/.test(name),
    ),
    options: { ...parsed.options, incremental: false, noEmit: true },
  });
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const program = webProgram(root);
  const files = program
    .getSourceFiles()
    .filter(
      (file) =>
        /[\\/]apps[\\/]web[\\/]src[\\/]/.test(file.fileName) &&
        outsideEdge(file.fileName),
    );
  const sites = effectSites(program, files, root);
  for (const site of sites)
    console.log(`${site.file}:${site.line}  ${site.hook}  (${site.spelled})`);
  const inFiles = new Set(sites.map((site) => site.file)).size;
  console.log(
    `${sites.length} effect call sites outside apps/web/src/ui/edge, in ${inFiles} files`,
  );
  if (process.argv.includes('--check') && sites.length > 0) process.exit(1);
}
