import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const root = join(import.meta.dir, '..');
const sources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(directory, entry.name)]
        : [],
  );

/** `listedWord` is a Drizzle fragment; a native Bun query binds it as a parameter and fails. */
const nativeTagsWithFragments = (file: string, text: string) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const drizzleSql = source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'drizzle-orm' &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) => element.name.text === 'sql',
      ),
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      let fragment = false;
      const find = (inner: ts.Node) => {
        if (
          ts.isCallExpression(inner) &&
          ts.isIdentifier(inner.expression) &&
          /^listedWords?$/.test(inner.expression.text)
        )
          fragment = true;
        else if (!ts.isTaggedTemplateExpression(inner))
          ts.forEachChild(inner, find);
      };
      ts.forEachChild(node.template, find);
      const tag = node.tag.getText(source);
      let shadowed = false;
      for (let at: ts.Node = node; !ts.isSourceFile(at); at = at.parent)
        if (
          ts.isFunctionLike(at) &&
          at.parameters.some(
            (parameter) => parameter.name.getText(source) === tag,
          )
        )
          shadowed = true;
      if (fragment && (tag !== 'sql' || !drizzleSql || shadowed))
        found.push(
          `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

test('a native Bun query takes listedValue, never a Drizzle fragment', () => {
  assert({
    given:
      'every packages/db source and a fixture that binds a fragment natively',
    should: 'find only the fixture',
    actual: [
      ...sources(join(root, 'src')).flatMap((file) =>
        nativeTagsWithFragments(
          relative(root, file),
          readFileSync(file, 'utf8'),
        ),
      ),
      ...nativeTagsWithFragments(
        'fixture.ts',
        "import { sql } from 'drizzle-orm';\nexport const f = (sql: SQL) => sql`select ${listedWord(list, 'a')}`;",
      ),
    ],
    expected: ['fixture.ts:2'],
  });
});
