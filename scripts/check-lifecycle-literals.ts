import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  bindingOf,
  literalValues,
  writtenStatuses,
  type ReadModule,
} from './lifecycle-write-values';
import { roomStatuses } from '@daisy/protocol/room-contract';
import { roundStatuses } from '@daisy/protocol/round';

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

const statusColumn = (node: ts.Expression, readModule: ReadModule) => {
  const table =
    (ts.isPropertyAccessExpression(node) && node.name.text === 'status') ||
    (ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'status')
      ? node.expression
      : undefined;
  if (!table || !ts.isIdentifier(table)) return undefined;
  if (isLifecycleTable(table.text)) return table.text;
  const binding = bindingOf(table, readModule);
  if (
    !binding ||
    !ts.isCallExpression(binding) ||
    !ts.isIdentifier(binding.expression) ||
    binding.expression.text !== 'alias'
  )
    return undefined;
  const base = binding.arguments[0];
  return base && ts.isIdentifier(base) && isLifecycleTable(base.text)
    ? base.text
    : undefined;
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
  readModule: ReadModule,
): string => {
  if (ts.isStringLiteralLike(template)) return template.text;
  const fragment = (expression: ts.Expression): string => {
    if (ts.isStringLiteralLike(expression))
      return `'${expression.text.replaceAll("'", "''")}'`;
    if (
      ts.isTaggedTemplateExpression(expression) &&
      expression.tag.getText(source) === 'sql'
    )
      return sqlTemplate(expression.template, source, readModule);
    const table = statusColumn(expression, readModule);
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

export function lifecycleLiteralIssues(
  { path, text }: Source,
  readSource: (path: string) => string | undefined = () => undefined,
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
    if (ts.isTaggedTemplateExpression(node)) {
      templates.push({
        node,
        sql: sqlTemplate(node.template, source, readModule),
      });
    }
    if (ts.isCallExpression(node)) {
      const [first, second] = node.arguments;
      const name = node.expression.getText(source);
      const destination = tableWrite(node.expression, source);
      if (first && destination && isLifecycleTable(destination))
        report(
          node,
          writtenStatuses(first, readModule).filter((word) =>
            tables[destination].has(word),
          ),
        );
      if ((name === 'sql.raw' || name.endsWith('.unsafe')) && first) {
        if (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))
          templates.push({ node, sql: sqlTemplate(first, source, readModule) });
      } else if (
        first &&
        second &&
        /^(?:eq|ne|inArray|notInArray|lt|lte|gt|gte)$/.test(name)
      ) {
        const table =
          statusColumn(first, readModule) ?? statusColumn(second, readModule);
        if (table && isLifecycleTable(table))
          report(
            node,
            [
              ...literalValues(first, readModule),
              ...literalValues(second, readModule),
            ].filter((word) => tables[table].has(word)),
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
    if (text === undefined || !/\bstatus\b|\.(?:insert|update)\(/.test(text))
      continue;
    for (const issue of lifecycleLiteralIssues({ path, text }, readSource)) {
      console.error(issue);
      count += 1;
    }
  }
  console.log(`${count} literal(s) in Round and Room lifecycle SQL`);
  process.exitCode = count === 0 ? 0 : 1;
}
