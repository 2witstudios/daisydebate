import ts from 'typescript';
import { roomStatuses, roundStatuses } from '@daisy/protocol';

const tables = {
  rooms: new Set<string>(roomStatuses),
  rounds: new Set<string>(roundStatuses),
};
type LifecycleTable = keyof typeof tables;
type Source = { readonly path: string; readonly text: string };

const isLifecycleTable = (name: string): name is LifecycleTable =>
  Object.hasOwn(tables, name);

const productionSource = (path: string) =>
  /^(?:apps|packages)\/[^/]+\/src\/.*\.(?:tsx?|sql)$/.test(path) &&
  !/\.(?:test|test-support)\.tsx?$/.test(path);

const statusColumn = (node: ts.Expression, source: ts.SourceFile) =>
  /^(rooms|rounds)(?:\.status|\[['"]status['"]\])$/.exec(
    node.getText(source),
  )?.[1];

const literalValues = (node: ts.Expression): readonly string[] => {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node))
    return node.elements.flatMap(literalValues);
  return [];
};

const trackedTables = (sql: string) => {
  const aliases = new Map<string, string>();
  for (const [, table, alias] of sql.matchAll(
    /\b(?:from|join|update|into)\s+(?:public\s*\.\s*)?([a-z_]\w*)(?:\s+(?:as\s+)?(?!where\b|set\b|join\b|on\b|left\b|right\b|cross\b|inner\b|order\b|group\b|returning\b|values\b|limit\b)([a-z_]\w*))?/gi,
  )) {
    if (table) aliases.set((alias ?? table).toLowerCase(), table.toLowerCase());
  }
  return aliases;
};

const quoted = "'(?:''|[^'])*'";
const column = '((?:[a-z_]\\w*\\s*\\.\\s*)?status)';
const equality = '(?:[<>]=?|=|<>|!=|is\\s+(?:not\\s+)?distinct\\s+from)';
const comparison = new RegExp(
  [
    `${column}\\s*(?:${equality}\\s*|(?:not\\s+)?in\\s*\\(\\s*|${equality}\\s*(?:any|all)\\s*\\(\\s*array\\s*\\[\\s*)(${quoted}(?:\\s*,\\s*${quoted})*)`,
    `(${quoted})\\s*${equality}\\s*${column}`,
  ].join('|'),
  'gi',
);

const unquote = (word: string) => word.slice(1, -1).replaceAll("''", "'");

function sqlLiterals(sql: string, fileSql: string, schema?: LifecycleTable) {
  const clean = sql
    .replaceAll(/--[^\n]*|\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/"([a-z_]\w*)"/gi, '$1');
  const local = trackedTables(clean);
  const outer = trackedTables(fileSql);
  const inferred = [...new Set(local.values())];
  const inferredTable = inferred.length === 1 ? inferred[0] : undefined;
  const found = new Set<string>();
  for (const [, left, rightWords, leftWord, right] of clean.matchAll(
    comparison,
  )) {
    const qualifier = (left ?? right)?.split('.')[0]?.trim().toLowerCase();
    const table =
      qualifier === 'status'
        ? (schema ?? inferredTable)
        : qualifier === 'table'
          ? schema
          : qualifier === undefined
            ? undefined
            : (local.get(qualifier) ??
              outer.get(qualifier) ??
              (qualifier === 'round'
                ? 'rounds'
                : qualifier === 'room'
                  ? 'rooms'
                  : qualifier));
    if (!table || !isLifecycleTable(table)) continue;
    for (const item of (rightWords ?? leftWord ?? '').matchAll(
      /'(?:''|[^'])*'/g,
    )) {
      const word = unquote(item[0]);
      if (tables[table].has(word)) found.add(word);
    }
  }

  // INSERT names the destination columns separately from each row of values.
  for (const [, table, columns, values] of clean.matchAll(
    /\binsert\s+into\s+(?:public\.)?(rooms|rounds)\s*\(([^)]+)\)\s*values\s*((?:\([^()]+\)(?:\s*,\s*)?)+)/gi,
  )) {
    if (!table || !columns || !values || !isLifecycleTable(table)) continue;
    const statusIndex = columns
      .split(',')
      .findIndex((name) => name.trim() === 'status');
    for (const [, tuple] of values.matchAll(/\(([^()]+)\)/g)) {
      const value = tuple?.split(',')[statusIndex]?.trim();
      if (value?.startsWith("'") && tables[table].has(unquote(value)))
        found.add(unquote(value));
    }
  }
  return [...found];
}

const sqlTemplate = (
  template: ts.TemplateLiteral | ts.StringLiteral,
  source: ts.SourceFile,
): string => {
  if (ts.isStringLiteralLike(template)) return template.text;
  const fragment = (expression: ts.Expression): string => {
    if (ts.isStringLiteralLike(expression))
      return `'${expression.text.replaceAll("'", "''")}'`;
    if (
      ts.isTaggedTemplateExpression(expression) &&
      expression.tag.getText(source) === 'sql'
    )
      return sqlTemplate(expression.template, source);
    const table = statusColumn(expression, source);
    return table
      ? `${table}.status`
      : expression.getText(source).replaceAll(/[^\w.]/g, '_');
  };
  return (
    template.head.text +
    template.templateSpans
      .map(({ expression, literal }) => fragment(expression) + literal.text)
      .join('')
  );
};

const writtenStatuses = (value: ts.Expression): readonly string[] => {
  if (ts.isArrayLiteralExpression(value))
    return value.elements.flatMap(writtenStatuses);
  if (!ts.isObjectLiteralExpression(value)) return [];
  return value.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return [];
    if (
      !ts.isIdentifier(property.name) &&
      !ts.isStringLiteralLike(property.name)
    )
      return [];
    return property.name.text === 'status'
      ? literalValues(property.initializer)
      : [];
  });
};

const tableWrite = (callee: ts.Expression, source: ts.SourceFile) => {
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !ts.isCallExpression(callee.expression)
  )
    return undefined;
  const builder = callee.expression;
  if (!ts.isPropertyAccessExpression(builder.expression)) return undefined;
  const name = `${builder.expression.name.text}.${callee.name.text}`;
  return name === 'insert.values' || name === 'update.set'
    ? builder.arguments[0]?.getText(source)
    : undefined;
};

export function lifecycleLiteralIssues({
  path,
  text,
}: Source): readonly string[] {
  if (!productionSource(path)) return [];
  const issues: string[] = [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const report = (node: ts.Node, values: readonly string[]) => {
    const line =
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    for (const value of values)
      issues.push(
        `${path}:${line}: read lifecycle status '${value}' from @daisy/protocol`,
      );
  };
  if (path.endsWith('.sql')) {
    report(source, sqlLiterals(text, text));
    return issues;
  }
  const schema = path.endsWith('/schema/rooms.ts')
    ? 'rooms'
    : path.endsWith('/schema/rounds.ts')
      ? 'rounds'
      : undefined;
  const templates: { readonly node: ts.Node; readonly sql: string }[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isTaggedTemplateExpression(node) &&
      /^sql(?:<.*>)?$/.test(node.tag.getText(source))
    ) {
      templates.push({ node, sql: sqlTemplate(node.template, source) });
    }
    if (ts.isCallExpression(node)) {
      const [first, second] = node.arguments;
      const name = node.expression.getText(source);
      const destination = tableWrite(node.expression, source);
      if (first && destination && isLifecycleTable(destination))
        report(
          node,
          writtenStatuses(first).filter((word) =>
            tables[destination].has(word),
          ),
        );
      if ((name === 'sql.raw' || name.endsWith('.unsafe')) && first) {
        if (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))
          templates.push({ node, sql: sqlTemplate(first, source) });
      } else if (
        first &&
        second &&
        /^(?:eq|ne|inArray|notInArray|lt|lte|gt|gte)$/.test(name)
      ) {
        const table =
          statusColumn(first, source) ?? statusColumn(second, source);
        if (table && isLifecycleTable(table))
          report(
            node,
            [...literalValues(first), ...literalValues(second)].filter((word) =>
              tables[table].has(word),
            ),
          );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const fileSql = templates.map(({ sql }) => sql).join('\n');
  for (const { node, sql } of templates)
    report(node, sqlLiterals(sql, fileSql, schema));
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
  let count = 0;
  for (const path of new Set(
    listed.stdout.toString().split('\n').filter(productionSource),
  )) {
    const file = Bun.file(path);
    if (!parent && !(await file.exists())) continue;
    const read = parent
      ? Bun.spawnSync(['git', 'show', `${parent}:${path}`])
      : null;
    if (read && read.exitCode !== 0) throw new Error(read.stderr.toString());
    const text = read ? read.stdout.toString() : await file.text();
    if (!/\bstatus\b/.test(text)) continue;
    for (const issue of lifecycleLiteralIssues({ path, text })) {
      console.error(issue);
      count += 1;
    }
  }
  console.log(`${count} literal(s) in Round and Room lifecycle SQL`);
  process.exitCode = count === 0 ? 0 : 1;
}
