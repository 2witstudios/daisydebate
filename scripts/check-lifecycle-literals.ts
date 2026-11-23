import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { bindingOf, type ReadModule } from './source-bindings';
import {
  loadStoredVocabularies,
  type StoredVocabularies,
  type Vocabulary,
} from './stored-vocabularies';

/**
 * A stored vocabulary word spelled in SQL text or a Drizzle call, where the
 * compiler cannot check it, is read from its list instead (RECON-3.11).
 * Every column a CHECK constrains with `oneOf` counts, in both databases.
 * A literal in a Drizzle call (`eq`, `inArray`, `.set`, `.values`) or
 * compared with a typed field stays legal: every such column carries its
 * list's union (schema-vocabularies.test.ts), so the compiler checks it.
 */
type Source = { readonly path: string; readonly text: string };
type StoredColumn = {
  readonly table: string;
  readonly column: string;
  readonly words: Vocabulary;
};

const storedVocabularies = await loadStoredVocabularies();

const productionSource = (path: string) =>
  /^(?:apps|packages)\/[^/]+\/src\/.*\.(?:tsx?|sql)$/.test(path) &&
  !/\.(?:test|test-support)\.tsx?$/.test(path) &&
  // An applied migration is history; it is never rewritten.
  !/\/migrations\//.test(path);

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quoted = "'(?:''|[^'])*'";
const equality = '(?:[<>]=?|=|<>|!=|is\\s+(?:not\\s+)?distinct\\s+from)';
const unquote = (word: string) => word.slice(1, -1).replaceAll("''", "'");

const patterns = new WeakMap<
  StoredVocabularies,
  { readonly comparison: RegExp; readonly insert: RegExp }
>();
function patternsOf(vocabularies: StoredVocabularies) {
  const known = patterns.get(vocabularies);
  if (known) return known;
  const columns = [
    ...new Set(
      [...vocabularies.sql.values()].flatMap((byColumn) => [
        ...byColumn.keys(),
      ]),
    ),
  ]
    .sort((left, right) => right.length - left.length)
    .map(escape)
    .join('|');
  const column = `((?:[a-z_]\\w*\\s*\\.\\s*)?\\b(?:${columns})\\b)`;
  const tables = [...vocabularies.sql.keys()].map(escape).join('|');
  const built = {
    comparison: new RegExp(
      [
        `${column}\\s*(?:${equality}\\s*|(?:not\\s+)?in\\s*\\(\\s*|${equality}\\s*(?:any|all)\\s*\\(\\s*array\\s*\\[\\s*)(${quoted}(?:\\s*,\\s*${quoted})*)`,
        `(${quoted})\\s*${equality}\\s*${column}`,
      ].join('|'),
      'gi',
    ),
    insert: new RegExp(
      `\\binsert\\s+into\\s+(?:public\\.)?(${tables})\\s*\\(([^)]+)\\)\\s*values\\s*((?:\\([^()]+\\)(?:\\s*,\\s*)?)+)`,
      'gi',
    ),
  };
  patterns.set(vocabularies, built);
  return built;
}

const trackedTables = (sql: string) => {
  const aliases = new Map<string, string>();
  for (const [, table, alias] of sql.matchAll(
    /\b(?:from|join|update|into)\s+(?:public\s*\.\s*)?([a-z_]\w*)(?:\s+(?:as\s+)?(?!where\b|set\b|join\b|on\b|left\b|right\b|cross\b|inner\b|order\b|group\b|returning\b|values\b|limit\b)([a-z_]\w*))?/gi,
  )) {
    if (table) aliases.set((alias ?? table).toLowerCase(), table.toLowerCase());
  }
  return aliases;
};

type Found = {
  readonly table: string;
  readonly column: string;
  readonly word: string;
};

function sqlLiterals(
  sql: string,
  fileSql: string,
  vocabularies: StoredVocabularies,
): readonly Found[] {
  const { comparison, insert } = patternsOf(vocabularies);
  const clean = sql
    .replaceAll(/--[^\n]*|\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/"([a-z_]\w*)"/gi, '$1');
  const local = trackedTables(clean);
  const outer = trackedTables(fileSql);
  const inferred = [...new Set(local.values())];
  const inferredTable = inferred.length === 1 ? inferred[0] : undefined;
  const found = new Map<string, Found>();
  const add = (table: string, column: string, word: string) => {
    if (vocabularies.sql.get(table)?.get(column)?.has(word))
      found.set(`${table}.${column}:${word}`, { table, column, word });
  };
  for (const [, left, rightWords, leftWord, right] of clean.matchAll(
    comparison,
  )) {
    const reference = (left ?? right ?? '')
      .replaceAll(/\s+/g, '')
      .toLowerCase();
    const [qualifier, column] = reference.includes('.')
      ? reference.split('.')
      : [undefined, reference];
    if (!column) continue;
    const table =
      qualifier === undefined
        ? inferredTable
        : (local.get(qualifier) ??
          outer.get(qualifier) ??
          (qualifier === 'round'
            ? 'rounds'
            : qualifier === 'room'
              ? 'rooms'
              : qualifier));
    if (!table) continue;
    for (const item of (rightWords ?? leftWord ?? '').matchAll(
      /'(?:''|[^'])*'/g,
    ))
      add(table, column, unquote(item[0]));
  }

  // INSERT names the destination columns separately from each row of values.
  for (const [, table, columns, values] of clean.matchAll(insert)) {
    if (!table || !columns || !values) continue;
    const names = columns.split(',').map((name) => name.trim().toLowerCase());
    for (const [, tuple] of values.matchAll(/\(([^()]+)\)/g)) {
      const cells = tuple?.split(',') ?? [];
      names.forEach((name, index) => {
        const value = cells[index]?.trim();
        if (value?.startsWith("'"))
          add(table.toLowerCase(), name, unquote(value));
      });
    }
  }
  return [...found.values()];
}

/** The stored column `node` names: `table.key`, an alias of a table, or a schema callback's `table`. */
function storedColumn(
  node: ts.Expression,
  readModule: ReadModule,
  vocabularies: StoredVocabularies,
): StoredColumn | undefined {
  const key = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : undefined;
  if (key === undefined) return undefined;
  const owner = (
    node as ts.PropertyAccessExpression | ts.ElementAccessExpression
  ).expression;
  if (!ts.isIdentifier(owner)) return undefined;
  const lookup = (exportName: string) => {
    const table = vocabularies.drizzle.get(exportName);
    const words = table?.columns.get(key);
    if (!table || !words) return undefined;
    const column = [...(vocabularies.sql.get(table.table) ?? [])].find(
      ([, set]) => set === words,
    )?.[0];
    return column ? { table: table.table, column, words } : undefined;
  };
  const direct = lookup(owner.text);
  if (direct) return direct;
  const binding = bindingOf(owner, readModule);
  if (
    binding &&
    ts.isCallExpression(binding) &&
    ts.isIdentifier(binding.expression) &&
    binding.expression.text === 'alias'
  ) {
    const base = binding.arguments[0];
    return base && ts.isIdentifier(base) ? lookup(base.text) : undefined;
  }
  // A schema file's `(table) => [...]` extras: the enclosing pgTable export.
  for (let at: ts.Node | undefined = owner.parent; at; at = at.parent) {
    if (
      ts.isArrowFunction(at) &&
      at.parameters.some(
        (parameter) =>
          ts.isIdentifier(parameter.name) && parameter.name.text === owner.text,
      ) &&
      ts.isCallExpression(at.parent) &&
      ts.isIdentifier(at.parent.expression) &&
      at.parent.expression.text === 'pgTable' &&
      ts.isVariableDeclaration(at.parent.parent) &&
      ts.isIdentifier(at.parent.parent.name)
    )
      return lookup(at.parent.parent.name.text);
  }
  return undefined;
}

const sqlTemplate = (
  template: ts.TemplateLiteral | ts.StringLiteral,
  source: ts.SourceFile,
  readModule: ReadModule,
  vocabularies: StoredVocabularies,
): string => {
  if (ts.isStringLiteralLike(template)) return template.text;
  const fragment = (expression: ts.Expression): string => {
    if (ts.isStringLiteralLike(expression))
      return `'${expression.text.replaceAll("'", "''")}'`;
    if (
      ts.isTaggedTemplateExpression(expression) &&
      expression.tag.getText(source) === 'sql'
    )
      return sqlTemplate(expression.template, source, readModule, vocabularies);
    const stored = storedColumn(expression, readModule, vocabularies);
    return stored
      ? `${stored.table}.${stored.column}`
      : expression.getText(source).replaceAll(/[^\w.]/g, '_');
  };
  return (
    template.head.text +
    template.templateSpans
      .map(({ expression, literal }) => fragment(expression) + literal.text)
      .join('')
  );
};

export function lifecycleLiteralIssues(
  { path, text }: Source,
  readSource: (path: string) => string | undefined = () => undefined,
  vocabularies: StoredVocabularies = storedVocabularies,
): readonly string[] {
  if (!productionSource(path)) return [];
  const issues: string[] = [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const parsed = new Map([[path, source]]);
  const readModule: ReadModule = (target) => {
    const prior = parsed.get(target);
    if (prior) return prior;
    const content = readSource(target);
    if (content === undefined) return undefined;
    const module = ts.createSourceFile(
      target,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    parsed.set(target, module);
    return module;
  };
  const report = (node: ts.Node, found: readonly Found[]) => {
    const line =
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    for (const { table, column, word } of found)
      issues.push(
        `${path}:${line}: '${word}' is a ${table}.${column} word; read it from its vocabulary list`,
      );
  };
  if (path.endsWith('.sql')) {
    report(source, sqlLiterals(text, text, vocabularies));
    return issues;
  }
  const templates: { readonly node: ts.Node; readonly sql: string }[] = [];
  function visit(node: ts.Node) {
    if (ts.isTaggedTemplateExpression(node)) {
      templates.push({
        node,
        sql: sqlTemplate(node.template, source, readModule, vocabularies),
      });
    }
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const name = node.expression.getText(source);
      if ((name === 'sql.raw' || name.endsWith('.unsafe')) && first) {
        if (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))
          templates.push({
            node,
            sql: sqlTemplate(first, source, readModule, vocabularies),
          });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const fileSql = templates.map(({ sql }) => sql).join('\n');
  for (const { node, sql } of templates)
    report(node, sqlLiterals(sql, fileSql, vocabularies));
  return issues;
}

if (import.meta.main) {
  const parent = process.argv[2];
  const listed = Bun.spawnSync(
    parent
      ? ['git', 'ls-tree', '-r', '--name-only', parent, 'apps', 'packages']
      : [
          'git',
          'ls-files',
          '--cached',
          '--others',
          '--exclude-standard',
          'apps',
          'packages',
        ],
  );
  if (listed.exitCode !== 0) throw new Error(listed.stderr.toString());
  const paths = new Set(
    listed.stdout.toString().split('\n').filter(productionSource),
  );
  const texts = new Map<string, string>();
  const readSource = (path: string): string | undefined => {
    if (!paths.has(path)) return undefined;
    const prior = texts.get(path);
    if (prior !== undefined) return prior;
    if (!parent && !existsSync(path)) return undefined;
    const read = parent
      ? Bun.spawnSync(['git', 'show', `${parent}:${path}`])
      : null;
    if (read && read.exitCode !== 0) throw new Error(read.stderr.toString());
    const text = read ? read.stdout.toString() : readFileSync(path, 'utf8');
    texts.set(path, text);
    return text;
  };
  let count = 0;
  for (const path of paths) {
    const text = readSource(path);
    if (text === undefined) continue;
    for (const issue of lifecycleLiteralIssues({ path, text }, readSource)) {
      console.error(issue);
      count += 1;
    }
  }
  let columns = 0;
  for (const byColumn of storedVocabularies.sql.values())
    columns += byColumn.size;
  console.log(
    `${count} stored vocabulary word(s) spelled in SQL text, over ${columns} CHECK-constrained columns`,
  );
  process.exitCode = count === 0 ? 0 : 1;
}
