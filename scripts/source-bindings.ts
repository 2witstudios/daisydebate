import { posix } from 'node:path';
import ts from 'typescript';

export type ReadModule = (path: string) => ts.SourceFile | undefined;

type Binding = ts.Expression | ts.FunctionDeclaration;

const declared = (
  statements: ts.NodeArray<ts.Statement>,
  name: string,
): Binding | undefined => {
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      return statement;
    if (!ts.isVariableStatement(statement)) continue;
    const variable = statement.declarationList.declarations.find(
      (item) => ts.isIdentifier(item.name) && item.name.text === name,
    );
    if (variable) return variable.initializer;
  }
  return undefined;
};

export function bindingOf(
  node: ts.Identifier,
  readModule: ReadModule,
): Binding | undefined {
  for (
    let scope: ts.Node | undefined = node.parent;
    scope;
    scope = scope.parent
  ) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    const local = declared(scope.statements, node.text);
    if (local) return local;
  }
  const source = node.getSourceFile();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const specifier = statement.moduleSpecifier.text;
    const imports = statement.importClause?.namedBindings;
    if (!specifier.startsWith('.') || !imports || !ts.isNamedImports(imports))
      continue;
    const named = imports.elements.find(({ name }) => name.text === node.text);
    if (!named) continue;
    const base = posix.join(posix.dirname(source.fileName), specifier);
    const target =
      readModule(`${base}.ts`) ??
      readModule(`${base}/index.ts`) ??
      readModule(base);
    if (target)
      return declared(
        target.statements,
        (named.propertyName ?? named.name).text,
      );
  }
  return undefined;
}
