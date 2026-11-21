import ts from 'typescript';

const clockModule = '@daisy/clock';

type ClockHelper = 'addMs' | 'instantMs' | 'nowMs' | 'tryInstantMs';
type Edit = { start: number; end: number; text: string };

function memberOwner(
  node: ts.Node,
  property: string,
): ts.Expression | undefined {
  if (ts.isPropertyAccessExpression(node) && node.name.text === property)
    return node.expression;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === property
  )
    return node.expression;
}

function fileBindings(file: ts.SourceFile) {
  return ts
    .createProgram(
      [file.fileName],
      { noLib: true, noResolve: true },
      {
        ...ts.createCompilerHost({}),
        getSourceFile: (name) => (name === file.fileName ? file : undefined),
      },
    )
    .getTypeChecker();
}

export function migrateDateParse(filePath: string, source: string): string {
  if (
    filePath.startsWith('packages/clock/') ||
    !source.includes('parse') ||
    !source.includes('Date')
  )
    return source;
  const file = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const usedNames = new Set<string>();
  const shadowingNames = new Set<string>();
  const bindings = new Map<ClockHelper, string>();
  const guards: ts.Identifier[] = [];
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
      ts.isIdentifier(node) &&
      !ts.isImportSpecifier(node.parent) &&
      ts.getNameOfDeclaration(node.parent) === node
    )
      shadowingNames.add(node.text);
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const owner =
        memberOwner(node.expression, 'isFinite') ??
        memberOwner(node.expression, 'isNaN');
      const argument = node.arguments[0]!;
      if (
        owner &&
        ts.isIdentifier(owner) &&
        owner.text === 'Number' &&
        ts.isIdentifier(argument)
      )
        guards.push(argument);
    }
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

  // Inspect bindings in this source file without resolving its imports.
  const checker = fileBindings(file);
  const checkedBindings = new Set(
    guards.map((name) => checker.getSymbolAtLocation(name)),
  );
  const isGlobal = (node: ts.Node, name: string) =>
    ts.isIdentifier(node) &&
    node.text === name &&
    !checker.getSymbolAtLocation(node)?.declarations?.length;
  const isDate = (
    node: ts.Expression,
    seen = new Set<ts.Symbol>(),
  ): boolean => {
    if (isGlobal(node, 'Date')) return true;
    const owner = memberOwner(node, 'Date');
    if (owner)
      return ['globalThis', 'window', 'self', 'global'].some((name) =>
        isGlobal(owner, name),
      );
    if (!ts.isIdentifier(node)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    const declaration = symbol?.valueDeclaration;
    if (
      !symbol ||
      seen.has(symbol) ||
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      !declaration.initializer
    )
      return false;
    seen.add(symbol);
    return isDate(declaration.initializer, seen);
  };
  const isParse = (node: ts.Node) => {
    const owner = memberOwner(node, 'parse');
    return owner !== undefined && isDate(owner);
  };
  const parseArgument = (node: ts.Node): ts.Expression | undefined => {
    if (ts.isCallExpression(node) && isParse(node.expression)) {
      const [argument] = node.arguments;
      if (argument && !ts.isSpreadElement(argument)) return argument;
    }
  };
  const isNumberMethod = (node: ts.Node, property: string) => {
    const owner = memberOwner(node, property);
    return owner !== undefined && isGlobal(owner, 'Number');
  };
  const checkedAssignment = (node: ts.Node): boolean => {
    while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
    const parent = node.parent;
    const target =
      ts.isVariableDeclaration(parent) && parent.initializer === node
        ? parent.name
        : ts.isBinaryExpression(parent) &&
            parent.right === node &&
            parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ? parent.left
          : undefined;
    if (!target || !ts.isIdentifier(target)) return false;
    const symbol = checker.getSymbolAtLocation(target);
    return symbol !== undefined && checkedBindings.has(symbol);
  };

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
        !item.isTypeOnly &&
        !shadowingNames.has(item.name.text) &&
        (item.propertyName ?? item.name).text === helper,
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
      const invalid = isNumberMethod(node.expression, 'isNaN');
      const valid = isNumberMethod(node.expression, 'isFinite');
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
        isDate(date.expression) &&
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
    if (instant && checkedAssignment(node)) {
      // Keep existing numeric refusal guards reachable after a failed parse.
      replace(
        node,
        `(${use('tryInstantMs')}(${instant.getText(file)}) ?? Number.NaN)`,
      );
      return;
    }
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
    if (isParse(node)) {
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
