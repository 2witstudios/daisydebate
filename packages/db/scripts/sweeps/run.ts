/** Route discarded Drizzle execute results through the raw statement runner. */
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import {
  applyEdits,
  ensureNamedImport,
  sourceFiles,
  type Edit,
} from './sweep-support';

const root = resolve(import.meta.dir, '../../src');

function discarded(node: ts.CallExpression): boolean {
  const containing = node.parent;
  if (ts.isExpressionStatement(containing)) return true;
  return (
    (ts.isAwaitExpression(containing) || ts.isVoidExpression(containing)) &&
    ts.isExpressionStatement(containing.parent)
  );
}

let moved = 0;
for (const file of sourceFiles(root)) {
  const text = await Bun.file(file).text();
  if (!text.includes('.execute(') || file === join(root, 'raw-rows.ts'))
    continue;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits: Edit[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'execute' &&
      node.arguments.length === 1 &&
      discarded(node)
    ) {
      const receiver = node.expression.expression.getText(source);
      const argument = node.arguments[0]?.getText(source);
      edits.push({
        start: node.getStart(source),
        end: node.getEnd(),
        text: `run(${receiver}, ${argument})`,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (edits.length === 0) continue;
  const collisions = new Set<string>();
  function collectIdentifiers(node: ts.Node) {
    if (ts.isIdentifier(node)) collisions.add(node.text);
    ts.forEachChild(node, collectIdentifiers);
  }
  collectIdentifiers(source);
  let localName = 'run';
  while (collisions.has(localName))
    localName =
      localName === 'run'
        ? 'runStatement'
        : `db${localName[0]?.toUpperCase()}${localName.slice(1)}`;
  let specifier = relative(dirname(file), join(root, 'raw-rows'));
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  const existing = source.statements.find(
    (node) =>
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === specifier,
  );
  const bindings =
    existing && ts.isImportDeclaration(existing)
      ? existing.importClause?.namedBindings
      : undefined;
  const imported =
    bindings && ts.isNamedImports(bindings)
      ? bindings.elements.find(
          (item) => (item.propertyName ?? item.name).text === 'run',
        )
      : undefined;
  const name = imported?.name.text ?? localName;
  const changed = applyEdits(
    text,
    edits.map((edit) => ({
      ...edit,
      text: name + edit.text.slice('run'.length),
    })),
  );
  await Bun.write(
    file,
    imported
      ? changed
      : ensureNamedImport(
          changed,
          specifier,
          name === 'run' ? name : `run as ${name}`,
          false,
        ),
  );
  moved += edits.length;
}
process.stdout.write(`Moved ${moved} discarded raw statements\n`);
