#!/usr/bin/env bun
/**
 * RECON-3.1 sweep: every transaction type in `packages/db/src` becomes `Tx`
 * or `TxSource` from `src/tx.ts`, and every `x.transaction(work)` becomes
 * `inTransaction(x, work)`. It finds each alias that only renames a
 * transaction type (`type Tx = Pick<BunSQLDatabase, 'execute'>`, an exported
 * `TabTransaction`, `Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0]`),
 * deletes it and rewrites its references and imports. Idempotent: run it
 * again after the parent branch takes main in, then `bun format`.
 *
 *   bun packages/db/scripts/sweeps/tx.ts
 */
import { relative, resolve, dirname } from 'node:path';
import ts from 'typescript';
import {
  applyEdits,
  ensureNamedImport,
  sourceFiles,
  type Edit,
} from './sweep-support';

const SRC = resolve(import.meta.dir, '../../src');
const HOME = resolve(SRC, 'tx.ts');

type Target = 'Tx' | 'TxSource';

/** Names that are a transaction type before any alias is read. */
const seeds: ReadonlyMap<string, Target> = new Map([
  ['BunSQLDatabase', 'TxSource'],
  ['BoundedTransactionContext', 'Tx'],
  ['Tx', 'Tx'],
  ['TxSource', 'TxSource'],
]);

const compact = (text: string) => text.replace(/\s+/g, '');

/** Whether a type node is a transaction type, given the names known so far. */
function classify(
  node: ts.TypeNode,
  known: ReadonlyMap<string, Target>,
): Target | null {
  if (ts.isParenthesizedTypeNode(node)) return classify(node.type, known);
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    if (name === 'Pick' && node.typeArguments?.length === 2) {
      const [base, keys] = node.typeArguments;
      if (!base || !keys || !classify(base, known)) return null;
      return /'transaction'|"transaction"/.test(keys.getText())
        ? 'TxSource'
        : 'Tx';
    }
    return known.get(name) ?? null;
  }
  if (ts.isIndexedAccessTypeNode(node)) {
    const text = compact(node.getText());
    const opener = /^Parameters<Parameters<(\w+)\['transaction'\]>\[0\]>\[0\]$/;
    const bounded = /^Parameters<Parameters<BoundedTransaction>\[0\]>\[0\]$/;
    const match = opener.exec(text);
    if (match?.[1] && known.get(match[1])) return 'TxSource';
    if (bounded.test(text)) return 'Tx';
  }
  return null;
}

const parse = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );

/** The aliases of one file that only rename a transaction type. */
function aliasesOf(
  source: ts.SourceFile,
  known: ReadonlyMap<string, Target>,
): Map<string, { target: Target; exported: boolean }> {
  const found = new Map<string, { target: Target; exported: boolean }>();
  let grew = true;
  while (grew) {
    grew = false;
    const scope = new Map([
      ...known,
      ...[...found].map(([name, { target }]) => [name, target] as const),
    ]);
    for (const statement of source.statements) {
      if (!ts.isTypeAliasDeclaration(statement)) continue;
      const name = statement.name.text;
      if (found.has(name) || statement.typeParameters) continue;
      const target = classify(statement.type, scope);
      if (!target) continue;
      found.set(name, { target, exported: isExported(statement) });
      grew = true;
    }
  }
  return found;
}

const files = sourceFiles(SRC).filter((file) => file !== HOME);
const texts = new Map(files.map((file) => [file, Bun.file(file).text()]));
const sources = new Map<string, ts.SourceFile>();
for (const [file, text] of texts) sources.set(file, parse(file, await text));

// Exported aliases are known everywhere; local ones only in their file.
const exported = new Map(seeds);
let grew = true;
while (grew) {
  grew = false;
  for (const source of sources.values())
    for (const [name, alias] of aliasesOf(source, exported))
      if (alias.exported && !exported.has(name)) {
        exported.set(name, alias.target);
        grew = true;
      }
}

const homeSpecifier = (file: string) => {
  const path = relative(dirname(file), HOME).replace(/\.ts$/, '');
  return path.startsWith('.') ? path : `./${path}`;
};

/** Pass 1: types. Pass 2 (repeated): one layer of `.transaction(` calls. */
function sweepTypes(file: string, source: ts.SourceFile): string | null {
  const local = aliasesOf(source, exported);
  const known = new Map([
    ...exported,
    ...[...local].map(([name, { target }]) => [name, target] as const),
  ]);
  const edits: Edit[] = [];
  const used = new Set<Target>();
  const removed = new Set([...exported.keys(), ...local.keys()]);
  removed.delete('Tx');
  removed.delete('TxSource');

  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && local.has(node.name.text)) {
      const start = node.getStart(source, true);
      let end = node.getEnd();
      if (source.text[end] === '\n') end += 1;
      edits.push({ start, end, text: '' });
      return;
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const clause = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause;
      if (!clause || (!ts.isNamedImports(clause) && !ts.isNamedExports(clause)))
        return;
      const elements = clause.elements as ts.NodeArray<
        ts.ImportSpecifier | ts.ExportSpecifier
      >;
      const keep = elements.filter(
        (element) => !removed.has((element.propertyName ?? element.name).text),
      );
      if (keep.length === elements.length) return;
      if (keep.length === 0 && !(ts.isImportDeclaration(node) && node.importClause?.name)) {
        let end = node.getEnd();
        if (source.text[end] === '\n') end += 1;
        edits.push({ start: node.getStart(source), end, text: '' });
        return;
      }
      edits.push({
        start: clause.getStart(source),
        end: clause.getEnd(),
        text: `{ ${keep.map((element) => element.getText(source)).join(', ')} }`,
      });
      return;
    }
    if (ts.isTypeNode(node)) {
      const target = classify(node, known);
      if (target) {
        used.add(target);
        if (node.getText(source) !== target)
          edits.push({
            start: node.getStart(source),
            end: node.getEnd(),
            text: target,
          });
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  if (edits.length === 0) return null;
  let text = applyEdits(source.text, edits);
  for (const target of used)
    text = ensureNamedImport(text, homeSpecifier(file), target, true);
  return text;
}

function sweepCalls(file: string, source: ts.SourceFile): string | null {
  const edits: Edit[] = [];
  const visit = (node: ts.Node): boolean => {
    let inner = false;
    ts.forEachChild(node, (child) => {
      if (visit(child)) inner = true;
    });
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'transaction'
    ) {
      if (!inner) {
        const target = node.expression.expression.getText(source);
        const args = node.arguments
          .map((argument) => argument.getText(source))
          .join(', ');
        edits.push({
          start: node.getStart(source),
          end: node.getEnd(),
          text: `inTransaction(${target}, ${args})`,
        });
      }
      return true;
    }
    return inner;
  };
  visit(source);
  if (edits.length === 0) return null;
  const text = applyEdits(source.text, edits);
  return ensureNamedImport(text, homeSpecifier(file), 'inTransaction', false);
}

let changed = 0;
for (const [file, source] of sources) {
  let text = sweepTypes(file, source) ?? source.text;
  for (;;) {
    const next = sweepCalls(file, parse(file, text));
    if (next === null) break;
    text = next;
  }
  if (text !== source.text) {
    await Bun.write(file, text);
    changed += 1;
  }
}
console.log(`tx sweep: ${changed} files changed`);
