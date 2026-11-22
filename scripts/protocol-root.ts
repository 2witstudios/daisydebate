import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';
import { isGlobal, sourceChecker } from './migration-bindings';

export const protocolPackage = '@daisy/protocol';
export const protocolDirectory = 'packages/protocol';
export const protocolBarrel = `${protocolDirectory}/src/index.ts`;

export function protocolRootExportIssue(exports: unknown): string | null {
  return typeof exports === 'string' ||
    (exports !== null &&
      typeof exports === 'object' &&
      (Array.isArray(exports) ||
        Object.keys(exports).some((key) => !key.startsWith('./'))))
    ? `${protocolPackage}: package exports must contain only owner subpaths`
    : null;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}

function moduleSpecifier(node: ts.Node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    return node.moduleSpecifier;
  if (ts.isExternalModuleReference(node)) return node.expression;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal;
  if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name))
    return node.name;
  if (ts.isCallExpression(node) && node.arguments[0])
    return unwrapExpression(node.arguments[0]);
}

function resolvesToBarrel(path: string, name: string): boolean {
  if (!name.startsWith('.')) return false;
  const target = posix
    .normalize(posix.join(posix.dirname(path), name))
    .replace(/\/$/, '')
    .replace(/\.[jt]s$/, '');
  return (
    target === `${protocolDirectory}/src/index` ||
    target === `${protocolDirectory}/src`
  );
}

export function protocolRootReferences(path: string, source: string) {
  // Include escaped literals and extensionless relative access to the old file.
  if (!/protocol|index|\\[ux]|['"`][.]{1,2}\/?['"`]/.test(source)) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const references: { node: ts.Node; specifier: ts.StringLiteralLike }[] = [];
  let checker: ts.TypeChecker | undefined;
  const isModuleLoad = (node: ts.Node) => {
    if (!ts.isCallExpression(node)) return true;
    const callee = unwrapExpression(node.expression);
    return (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) &&
        callee.text === 'require' &&
        isGlobal((checker ??= sourceChecker(file)), callee, 'require'))
    );
  };
  const visit = (node: ts.Node) => {
    const specifier = moduleSpecifier(node);
    if (
      specifier &&
      ts.isStringLiteralLike(specifier) &&
      (specifier.text === protocolPackage ||
        resolvesToBarrel(path, specifier.text)) &&
      isModuleLoad(node)
    )
      references.push({ node, specifier });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return references;
}

export function* repositorySources(
  cwd: string,
  pathspecs: readonly string[] = [],
) {
  const files = Bun.spawnSync(
    [
      'git',
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...pathspecs,
    ],
    { cwd },
  );
  if (files.exitCode !== 0) throw new Error(files.stderr.toString());
  for (const path of new Set(files.stdout.toString().split('\0'))) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    const absolutePath = posix.join(cwd, path);
    if (existsSync(absolutePath))
      yield { path, absolutePath, source: readFileSync(absolutePath, 'utf8') };
  }
}
