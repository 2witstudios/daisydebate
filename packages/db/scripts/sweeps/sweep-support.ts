/**
 * What the `packages/db` boundary sweeps share: the files they read, text
 * edits by position, and adding a named import.
 */
import ts from 'typescript';

export type Edit = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

/** Every TypeScript file under `root`, sorted. */
export const sourceFiles = (root: string): string[] =>
  [...new Bun.Glob('**/*.ts').scanSync({ cwd: root, absolute: true })].sort();

/** Applies non-overlapping edits to `text`, last first. */
export const applyEdits = (text: string, edits: readonly Edit[]): string =>
  [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.start) + edit.text + result.slice(edit.end),
      text,
    );

/**
 * `text` with `name` imported from `specifier`: added to an import of that
 * module if there is one, or as a new import after the last one.
 */
export function ensureNamedImport(
  text: string,
  specifier: string,
  name: string,
  typeOnly: boolean,
): string {
  const source = ts.createSourceFile(
    'file.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = source.statements.filter(ts.isImportDeclaration);
  const existing = imports.find(
    (statement) =>
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === specifier &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings),
  );
  if (existing?.importClause?.namedBindings) {
    const clause = existing.importClause;
    const bindings = clause.namedBindings as ts.NamedImports;
    if (bindings.elements.some((element) => element.name.text === name))
      return text;
    const allTypes = clause.isTypeOnly;
    const parts = bindings.elements.map((element) =>
      allTypes && !typeOnly
        ? `type ${element.getText(source)}`
        : element.getText(source),
    );
    parts.push(typeOnly && !allTypes ? `type ${name}` : name);
    const keepTypeOnly = allTypes && typeOnly;
    const head = keepTypeOnly ? 'import type' : 'import';
    const rebuilt = `${head} { ${parts.join(', ')} } from '${specifier}';`;
    return applyEdits(text, [
      { start: existing.getStart(source), end: existing.getEnd(), text: rebuilt },
    ]);
  }
  const line = `import ${typeOnly ? 'type ' : ''}{ ${name} } from '${specifier}';\n`;
  const last = imports.at(-1);
  const at = last ? last.getEnd() + 1 : 0;
  return text.slice(0, at) + line + text.slice(at);
}
