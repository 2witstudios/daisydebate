#!/usr/bin/env bun
/**
 * RECON-3.1 sweep: every transaction type in `packages/db` becomes `Tx`,
 * `TxSource` or `TxOpener` from `src/tx.ts`, and every `x.transaction(work)`
 * in `src` becomes `inTransaction(x, work)`. It finds each alias that only
 * renames a transaction type (`type Tx = Pick<BunSQLDatabase, 'execute'>`,
 * an exported `TabTransaction`,
 * `Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0]`, an object
 * type with nothing but a `transaction` method), deletes it and rewrites its
 * references and imports. A `transaction` property whose work takes more
 * than the transaction (a bounded writer's signal and receipt) is not an
 * opener; it is listed for a rename. Idempotent: run it again after the
 * parent branch takes main in, then format the changed files.
 *
 *   bun packages/db/scripts/sweeps/tx.ts
 */
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import {
  applyEdits,
  ensureNamedImport,
  sourceFiles,
  type Edit,
} from './sweep-support';

const PACKAGE = resolve(import.meta.dir, '../..');
const SRC = resolve(PACKAGE, 'src');
const HOME = resolve(SRC, 'tx.ts');
const HOME_NAMES = new Set(['Tx', 'TxSource', 'TxOpener', 'inTransaction']);

type Target = 'Tx' | 'TxSource' | 'TxOpener';

/** Names that are a transaction type before any alias is read. */
const seeds: ReadonlyMap<string, Target> = new Map([
  ['BunSQLDatabase', 'TxSource'],
  ['BoundedTransactionContext', 'Tx'],
  ['Tx', 'Tx'],
  ['TxSource', 'TxSource'],
  ['TxOpener', 'TxOpener'],
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
    if (name === 'TxOpener' && node.typeArguments) return null;
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
  if (ts.isTypeLiteralNode(node) && node.members.length === 1) {
    const text = compact(node.getText()).replace(/;?\}$/, '}');
    const shape =
      /^\{(?:readonly)?transaction:<(\w+)>\(\w+:\(\w+:(\w+)\)=>Promise<\1>\)=>Promise<\1>\}$/;
    const match = shape.exec(text);
    if (match?.[2] && known.get(match[2]) === 'Tx') return 'TxOpener';
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

const homeSpecifier = (file: string) => {
  const path = relative(dirname(file), HOME).replace(/\.ts$/, '');
  return path.startsWith('.') ? path : `./${path}`;
};

const removeStatement = (source: ts.SourceFile, node: ts.Node): Edit => {
  let end = node.getEnd();
  if (source.text[end] === '\n') end += 1;
  return { start: node.getStart(source, true), end, text: '' };
};

/**
 * Pass 1, on the program as it stands: each `x.transaction(work)` whose work
 * takes only the transaction becomes `inTransaction(x, work)`, nested calls
 * included.
 */
function sweepCalls(
  program: ts.Program,
  source: ts.SourceFile,
  refused: string[],
): string | null {
  const checker = program.getTypeChecker();
  const isOpenerCall = (
    node: ts.Node,
  ): node is ts.CallExpression & {
    expression: ts.PropertyAccessExpression;
  } => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== 'transaction'
    )
      return false;
    const signature = checker.getResolvedSignature(node);
    const work = signature?.parameters[0];
    const workType = work && checker.getTypeOfSymbolAtLocation(work, node);
    const takes = workType?.getCallSignatures()[0]?.parameters.length ?? 0;
    if (takes > 1) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      refused.push(
        `${relative(PACKAGE, source.fileName)}:${line + 1} ${node.expression.getText(source)}`,
      );
      return false;
    }
    return true;
  };
  const rewrite = (node: ts.Node): Edit[] => {
    if (!isOpenerCall(node))
      return node.getChildren(source).flatMap((child) => rewrite(child));
    const render = (part: ts.Node) => {
      const start = part.getStart(source);
      return applyEdits(
        part.getText(source),
        rewrite(part).map((edit) => ({
          ...edit,
          start: edit.start - start,
          end: edit.end - start,
        })),
      );
    };
    const parts = [node.expression.expression, ...node.arguments].map(render);
    return [
      {
        start: node.getStart(source),
        end: node.getEnd(),
        text: `inTransaction(${parts.join(', ')})`,
      },
    ];
  };
  const edits = rewrite(source);
  if (edits.length === 0) return null;
  return ensureNamedImport(
    applyEdits(source.text, edits),
    homeSpecifier(source.fileName),
    'inTransaction',
    false,
  );
}

/** Pass 2, on text: transaction types and their imports. */
function sweepTypes(
  source: ts.SourceFile,
  exported: ReadonlyMap<string, Target>,
): string | null {
  const local = aliasesOf(source, exported);
  const known = new Map([
    ...exported,
    ...[...local].map(([name, { target }]) => [name, target] as const),
  ]);
  const removed = new Set([...exported.keys(), ...local.keys()]);
  const home = homeSpecifier(source.fileName);
  const edits: Edit[] = [];
  const used = new Set<Target>();

  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && local.has(node.name.text)) {
      edits.push(removeStatement(source, node));
      return;
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const module =
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : null;
      if (module === home) return;
      const clause = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause;
      if (!clause || (!ts.isNamedImports(clause) && !ts.isNamedExports(clause)))
        return;
      const elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[] =
        clause.elements;
      const gone = (element: ts.ImportSpecifier | ts.ExportSpecifier) => {
        const name = (element.propertyName ?? element.name).getText(source);
        return removed.has(name) || (module !== null && HOME_NAMES.has(name));
      };
      for (const element of elements) {
        const target = element.propertyName
          ? known.get(element.propertyName.getText(source))
          : undefined;
        if (target && ts.isImportSpecifier(element))
          known.set(element.name.text, target);
      }
      const keep = elements.filter((element) => !gone(element));
      if (keep.length === elements.length) return;
      const defaultImport =
        ts.isImportDeclaration(node) && node.importClause?.name;
      if (keep.length === 0 && !defaultImport) {
        edits.push(removeStatement(source, node));
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
  for (const target of used) text = ensureNamedImport(text, home, target, true);
  return text;
}

const config = ts.getParsedCommandLineOfConfigFile(
  resolve(PACKAGE, 'tsconfig.json'),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
);
if (!config) throw new Error('packages/db/tsconfig.json did not parse');
const program = ts.createProgram(config.fileNames, config.options);
const files = [
  ...sourceFiles(SRC),
  ...sourceFiles(resolve(PACKAGE, 'integration')),
].filter((file) => file !== HOME);

const refused: string[] = [];
const texts = new Map<string, string>();
for (const file of files) {
  const original = await Bun.file(file).text();
  const programSource = program.getSourceFile(file);
  const called =
    file.startsWith(SRC) && programSource
      ? sweepCalls(program, programSource, refused)
      : null;
  texts.set(file, called ?? original);
}

// Exported aliases are known everywhere; local ones only in their file.
const sources = new Map(
  [...texts].map(([file, text]) => [file, parse(file, text)] as const),
);
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

let changed = 0;
for (const [file, source] of sources) {
  const text = sweepTypes(source, exported) ?? source.text;
  if (text !== (await Bun.file(file).text())) {
    await Bun.write(file, text);
    changed += 1;
  }
}
console.log(`tx sweep: ${changed} files changed`);
if (refused.length > 0)
  console.log(
    `not openers (their work takes more than the transaction), rename them:\n  ${refused.join('\n  ')}`,
  );
