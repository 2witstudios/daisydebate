import ts from 'typescript';
import {
  constInitializer,
  hasOtherDeclaration,
  isGlobal,
  memberName,
  sourceChecker,
  staticText,
  unparenthesized,
  usesCommonJs,
} from './migration-bindings';

const clockModule = '@daisy/clock';

type ClockHelper = 'addMs' | 'instantMs' | 'nowMs' | 'tryInstantMs';
type Edit = { start: number; end: number; text: string };

export function migrateDateParse(
  filePath: string,
  source: string,
  manual?: () => void,
): string {
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

  const checker = sourceChecker(file);
  const memberOwner = (node: ts.Node, property: string) =>
    (ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)) &&
    memberName(checker, node) === property
      ? node.expression
      : undefined;
  const isNumberMethod = (node: ts.Node, property: string) => {
    const owner = memberOwner(node, property);
    return owner !== undefined && isGlobal(checker, owner, 'Number');
  };
  const usedNames = new Set<string>();
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
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      (isNumberMethod(node.expression, 'isFinite') ||
        isNumberMethod(node.expression, 'isNaN'))
    ) {
      const argument = unparenthesized(node.arguments[0]!);
      if (ts.isIdentifier(argument)) guards.push(argument);
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

  const checkedBindings = new Set(
    guards.map((name) => checker.getSymbolAtLocation(name)),
  );
  const isDate = (
    expression: ts.Expression,
    seen = new Set<ts.Symbol>(),
  ): boolean => {
    const node = unparenthesized(expression);
    if (isGlobal(checker, node, 'Date')) return true;
    const owner = memberOwner(node, 'Date');
    if (owner)
      return ['globalThis', 'window', 'self', 'global'].some((name) =>
        isGlobal(checker, unparenthesized(owner), name),
      );
    const initializer = constInitializer(checker, node, seen);
    return initializer !== undefined && isDate(initializer, seen);
  };
  const isParse = (node: ts.Node) => {
    const owner = memberOwner(unparenthesized(node), 'parse');
    return owner !== undefined && isDate(owner);
  };
  const parseArgument = (expression: ts.Node): ts.Expression | undefined => {
    const node = unparenthesized(expression);
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      isParse(node.expression)
    ) {
      const [argument] = node.arguments;
      if (argument && !ts.isSpreadElement(argument)) return argument;
    }
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
        !hasOtherDeclaration(checker, file, item.name) &&
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

  const isParseKey = (key: ts.Node | undefined): boolean => {
    if (!key) return false;
    if (ts.isIdentifier(key) || ts.isStringLiteralLike(key))
      return key.text === 'parse';
    return (
      ts.isComputedPropertyName(key) &&
      staticText(checker, key.expression) === 'parse'
    );
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isDate(node.initializer) &&
      node.name.elements.some(
        (binding) =>
          !binding.dotDotDotToken &&
          isParseKey(binding.propertyName ?? binding.name),
      )
    )
      manual?.();
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const pattern = unparenthesized(node.left);
      if (
        ts.isObjectLiteralExpression(pattern) &&
        isDate(node.right) &&
        pattern.properties.some((property) => isParseKey(property.name))
      )
        manual?.();
    }

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
        `(${use('tryInstantMs')}(${instant.getText(file)}) ?? 0 / 0)`,
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
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      isParse(node)
    ) {
      let callee: ts.Node = node;
      while (ts.isParenthesizedExpression(callee.parent))
        callee = callee.parent;
      if (
        ts.isCallExpression(callee.parent) &&
        callee.parent.expression === callee &&
        parseArgument(callee.parent)
      )
        replace(node, use('instantMs'));
      else manual?.();
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!edits.length) return source;
  if (usesCommonJs(checker, file)) {
    manual?.();
    return source;
  }
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
  return migrateDateParse(filePath, migrated, manual);
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
  const manual = new Set<string>();
  for (const path of new Set(result.stdout.toString().split('\0'))) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    const source = await file.text();
    const migrated = migrateDateParse(path, source, () => manual.add(path));
    if (migrated === source) continue;
    changed++;
    if (mode === '--write') await Bun.write(path, migrated);
    else console.log(path);
  }
  console.log(
    `${changed} files ${mode === '--write' ? 'migrated' : 'to migrate'}`,
  );
  for (const path of manual)
    console.log(`Manual Date.parse migration needed: ${path}`);
  if ((mode === '--check' && changed > 0) || manual.size > 0)
    process.exitCode = 1;
}

if (import.meta.main) await run(process.argv.slice(2));
