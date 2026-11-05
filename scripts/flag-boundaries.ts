import { posix } from 'node:path';
import * as ts from 'typescript';

type Module = {
  readonly imports: readonly string[];
  readonly protectedScope: boolean;
  readonly flagLiteral: boolean;
};
const isTest = (path: string) =>
  /\.(test|test-support|integration|e2e)\.tsx?$/.test(path);
const flagModule = (path: string) =>
  path.startsWith('apps/web/src/features/flags/') ||
  path === '@daisy/db/flags' ||
  path === '@daisy/protocol/flags';

function moduleOf(path: string, text: string, keys: readonly string[]): Module {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  let protectedScope = /(^|\/)proxy\.tsx?$/.test(path);
  let flagLiteral = false;
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)) {
      const directive = node.expression.text;
      if (directive === 'use client' || /^use cache(?:$|:)/.test(directive))
        protectedScope = true;
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      keys.includes(node.text)
    )
      flagLiteral = true;
    const specifier = importedSpecifier(node);
    if (specifier) imports.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, protectedScope, flagLiteral };
}

/** Follow re-exports and indirect imports; a guard on only the immediate import is bypassable. */
export function flagBoundaryProblems(
  sources: ReadonlyMap<string, string>,
  keys: readonly string[],
): readonly string[] {
  const modules = new Map(
    [...sources]
      .filter(([path]) => !isTest(path))
      .map(([path, source]) => [path, moduleOf(path, source, keys)]),
  );
  const targetOf = (from: string, specifier: string) => {
    if (!specifier.startsWith('.')) return specifier;
    const path = posix.normalize(posix.join(posix.dirname(from), specifier));
    return (
      [
        path,
        `${path}.ts`,
        `${path}.tsx`,
        `${path}/index.ts`,
        `${path}/index.tsx`,
      ].find((candidate) => modules.has(candidate)) ?? path
    );
  };
  const reachesFlags = (path: string, seen: Set<string>): boolean => {
    if (flagModule(path) || modules.get(path)?.flagLiteral) return true;
    if (seen.has(path)) return false;
    seen.add(path);
    return (
      modules
        .get(path)
        ?.imports.some((specifier) =>
          reachesFlags(targetOf(path, specifier), seen),
        ) ?? false
    );
  };
  return [...modules].flatMap(([path, module]) =>
    module.protectedScope &&
    (module.flagLiteral || reachesFlags(path, new Set()))
      ? [
          `${path}: release flags are server-only and cannot enter client, proxy or use cache scopes (ADR 0118)`,
        ]
      : [],
  );
}

function importedSpecifier(node: ts.Node): string | null {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  )
    return node.moduleSpecifier.text;
  if (!ts.isCallExpression(node)) return null;
  const importing =
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === 'require');
  const first = node.arguments[0];
  return importing && first && ts.isStringLiteral(first) ? first.text : null;
}
