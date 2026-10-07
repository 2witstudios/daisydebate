// The index of what each TypeScript source file really exports: the proof a
// `policy/*.json` registry cannot name an export that does not exist. Split
// from `policy.ts` so that file stays under its 400-line ceiling.

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import * as ts from 'typescript';

const root = resolve(import.meta.dir, '..');

/**
 * The public names one `export { … }` clause or `export * as ns` clause
 * contributes: the name a consumer imports, alias or not.
 */
function exportClauseNames(
  clause: ts.ExportDeclaration['exportClause'],
): readonly string[] {
  if (!clause) return [];
  if (ts.isNamedExports(clause))
    return clause.elements.map((element) => element.name.text);
  return ts.isNamespaceExport(clause) ? [clause.name.text] : [];
}

/** The names one top-level exported declaration makes importable. */
function exportedDeclarationNames(statement: ts.Statement): readonly string[] {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    );
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  )
    return statement.name ? [statement.name.text] : [];
  return [];
}

/**
 * The public names one TypeScript source file really exports, read from the
 * AST so an `export { a as c }` list indexes the name a consumer imports (`c`)
 * however many lines the list spans, and `export abstract class` indexes like
 * any other declaration. Only top-level statements can carry `export`, and
 * exports nested in a namespace are not directly importable, so the walk stays
 * at the top level.
 */
export function exportedNames(path: string, source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      for (const name of exportClauseNames(statement.exportClause))
        names.add(name);
      continue;
    }
    const exported =
      ts.canHaveModifiers(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
    if (exported)
      for (const name of exportedDeclarationNames(statement)) names.add(name);
  }
  return [...names];
}

/**
 * The symbols each TypeScript source file really declares, so a registry entry
 * cannot name an export that does not exist. Only `.ts` and `.tsx` files are
 * indexed: any other declaration path stays out of the map, which the symbol
 * check reports instead of accepting a name it cannot prove.
 */
export async function collectExportNames(
  files: readonly string[],
  knownPaths: ReadonlySet<string>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const index = new Map<string, readonly string[]>();
  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
    const relativePath = relative(root, file);
    if (!knownPaths.has(relativePath)) continue;
    index.set(
      relativePath,
      exportedNames(relativePath, await readFile(file, 'utf8')),
    );
  }
  return index;
}
