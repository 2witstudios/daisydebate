import ts from 'typescript';

const clockModule = '@daisy/clock';

type ClockHelper = 'addMs' | 'instantMs' | 'nowMs' | 'tryInstantMs';
type Edit = { start: number; end: number; text: string };

function member(node: ts.Node, owner: string, property: string): boolean {
  return (
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === owner &&
      node.name.text === property) ||
    (ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === owner &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === property)
  );
}

function parseArgument(node: ts.Node): ts.Expression | undefined {
  if (ts.isCallExpression(node) && member(node.expression, 'Date', 'parse')) {
    const [argument] = node.arguments;
    if (argument && !ts.isSpreadElement(argument)) return argument;
  }
}

export function migrateDateParse(filePath: string, source: string): string {
  if (filePath.startsWith('packages/clock/') || !source.includes('parse'))
    return source;
  const file = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const usedNames = new Set<string>();
  const bindings = new Map<ClockHelper, string>();
  let namedImports: ts.NamedImports | undefined;
  const collectNames = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      !(
        (ts.isPropertyAccessExpression(node.parent) ||
          ts.isPropertyAssignment(node.parent) ||
          ts.isMethodDeclaration(node.parent)) &&
        node.parent.name === node
      )
    )
      usedNames.add(node.text);
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === clockModule &&
      !node.importClause?.isTypeOnly
    ) {
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) namedImports = named;
    }
    ts.forEachChild(node, collectNames);
  };
  collectNames(file);

  const imports: string[] = [];
  function use(helper: ClockHelper): string {
    const existing = bindings.get(helper);
    if (existing) return existing;
    const prefix = `clock${helper[0]?.toUpperCase()}${helper.slice(1)}`;
    let local: string = usedNames.has(helper) ? prefix : helper;
    for (let suffix = 2; usedNames.has(local); suffix++)
      local = `${prefix}${suffix}`;
    const imported = namedImports?.elements.find(
      (item) =>
        !item.isTypeOnly && (item.propertyName ?? item.name).text === helper,
    );
    if (imported) {
      bindings.set(helper, imported.name.text);
      return imported.name.text;
    }
    imports.push(local === helper ? helper : `${helper} as ${local}`);
    usedNames.add(local);
    bindings.set(helper, local);
    return local;
  }

  const edits: Edit[] = [];
  const replace = (node: ts.Node, text: string) => {
    edits.push({ start: node.getStart(file), end: node.end, text });
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const invalid = member(node.expression, 'Number', 'isNaN');
      const valid = member(node.expression, 'Number', 'isFinite');
      const argument = node.arguments[0];
      const instant =
        argument && (valid || invalid) ? parseArgument(argument) : undefined;
      if (instant) {
        replace(
          node,
          `(${use('tryInstantMs')}(${instant.getText(file)}) ${valid ? '!==' : '==='} undefined)`,
        );
        return;
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'toISOString' &&
      !node.questionDotToken &&
      node.arguments.length === 0
    ) {
      const date = node.expression.expression;
      if (
        ts.isNewExpression(date) &&
        ts.isIdentifier(date.expression) &&
        date.expression.text === 'Date' &&
        date.arguments?.length === 1
      ) {
        const addition = date.arguments[0];
        if (addition && ts.isBinaryExpression(addition)) {
          const instant = parseArgument(addition.left);
          const operator = addition.operatorToken.kind;
          if (
            instant &&
            (operator === ts.SyntaxKind.PlusToken ||
              operator === ts.SyntaxKind.MinusToken)
          ) {
            const duration = addition.right.getText(file);
            replace(
              node,
              `${use('addMs')}(${instant.getText(file)}, ${operator === ts.SyntaxKind.MinusToken ? `-(${duration})` : duration})`,
            );
            return;
          }
        }
      }
    }

    const instant = parseArgument(node);
    if (
      instant &&
      ts.isCallExpression(instant) &&
      !instant.questionDotToken &&
      instant.arguments.length === 0 &&
      ts.isPropertyAccessExpression(instant.expression) &&
      !instant.expression.questionDotToken &&
      instant.expression.name.text === 'now'
    ) {
      replace(
        node,
        `${use('nowMs')}(${instant.expression.expression.getText(file)})`,
      );
      return;
    }
    if (member(node, 'Date', 'parse')) {
      replace(node, use('instantMs'));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!edits.length) return source;
  if (imports.length > 0) {
    if (namedImports) {
      const open =
        namedImports.elements[0]?.getStart(file) ??
        namedImports.getStart(file) + 1;
      edits.push({
        start: open,
        end: open,
        text: namedImports.elements.length
          ? `${imports.join(', ')}, `
          : ` ${imports.join(', ')} `,
      });
    } else {
      // Preserve the shebang, directive prologue, and leading file comments.
      const statement = file.statements.find(
        (item) =>
          !ts.isExpressionStatement(item) ||
          !ts.isStringLiteral(item.expression),
      );
      const start = statement?.getStart(file) ?? source.length;
      const offset =
        start === 0 && source.startsWith('#!')
          ? source.indexOf('\n') + 1
          : start;
      edits.push({
        start: offset,
        end: offset,
        text: `${offset === 0 ? '' : '\n'}import { ${imports.join(', ')} } from '${clockModule}';\n`,
      });
    }
  }
  const migrated = edits
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce(
      (current, edit) =>
        current.slice(0, edit.start) + edit.text + current.slice(edit.end),
      source,
    );
  return migrateDateParse(filePath, migrated);
}

async function run(args: string[]) {
  const mode = args.shift();
  if (mode !== '--check' && mode !== '--write')
    throw new Error(
      'Usage: bun scripts/migrate-date-parse.ts --check|--write [git pathspecs]',
    );
  const result = Bun.spawnSync([
    'git',
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    ...args,
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  let changed = 0;
  for (const path of new Set(result.stdout.toString().split('\0'))) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    const source = await file.text();
    const migrated = migrateDateParse(path, source);
    if (migrated === source) continue;
    changed++;
    if (mode === '--write') await Bun.write(path, migrated);
    else console.log(path);
  }
  console.log(
    `${changed} files ${mode === '--write' ? 'migrated' : 'to migrate'}`,
  );
  if (mode === '--check' && changed > 0) process.exitCode = 1;
}

if (import.meta.main) await run(process.argv.slice(2));
