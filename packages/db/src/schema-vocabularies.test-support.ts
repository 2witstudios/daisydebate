import { dirname, join } from 'node:path';
import ts from 'typescript';

/**
 * Every column a CHECK constrains with `oneOf(column, vocabulary)`, and
 * whether the column's TypeScript type carries that vocabulary (RECON-3.11).
 * Drizzle hands a table's extra config untyped columns, so the compiler
 * cannot hold `oneOf`'s two arguments together; this reads the table's own
 * column type instead, through the type checker. An unresolved column or
 * list never passes.
 */
export type VocabularyColumn = {
  /** `<file>:<line> <table export>.<column>` */
  readonly site: string;
  /** The column's declared value type, as the checker prints it. */
  readonly declared: string;
  /** The CHECK's vocabulary. */
  readonly vocabulary: string;
  /**
   * `vocabulary`: the CHECK constrains the column to the list (`oneOf` is the
   * whole check, or follows `<column> is null or`), so the column's type is
   * exactly the list's union. `predicate`: the list is a condition in a
   * larger CHECK, so it names only members of the column's own type (any
   * string for an open column such as an id).
   */
  readonly role: 'vocabulary' | 'predicate';
  readonly exact: boolean;
};

const literalsOf = (type: ts.Type): ReadonlySet<string> | null => {
  const members = type.isUnion() ? type.types : [type];
  const values = new Set<string>();
  for (const member of members) {
    if (!member.isStringLiteral()) return null;
    values.add(member.value);
  }
  return values;
};

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((value) => right.has(value));

const isSubset = (part: ReadonlySet<string>, whole: ReadonlySet<string>) =>
  [...part].every((value) => whole.has(value));

const printed = (values: ReadonlySet<string> | null) =>
  values ? [...values].map((value) => `"${value}"`).join(' | ') : 'unresolved';

/** The members of a list's type: a tuple, a readonly array or a union of literals. */
function listMembers(type: ts.Type, checker: ts.TypeChecker) {
  const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  return element ? literalsOf(element) : null;
}

/** An array written in place: its string elements and the members of its spreads. */
function inlineVocabulary(
  list: ts.ArrayLiteralExpression,
  checker: ts.TypeChecker,
): ReadonlySet<string> | null {
  const values = new Set<string>();
  for (const item of list.elements) {
    if (ts.isStringLiteralLike(item)) values.add(item.text);
    else if (ts.isSpreadElement(item)) {
      const members = listMembers(
        checker.getTypeAtLocation(item.expression),
        checker,
      );
      if (!members) return null;
      for (const value of members) values.add(value);
    } else return null;
  }
  return values;
}

/** Whether a `oneOf` call is the constraint of its CHECK, not a condition in one. */
function constrains(call: ts.CallExpression, column: ts.Expression) {
  const parent = call.parent;
  if (
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'check'
  )
    return true;
  if (!ts.isTemplateSpan(parent)) return false;
  const spans = parent.parent.templateSpans;
  const previous = spans[spans.indexOf(parent) - 1];
  return (
    previous !== undefined &&
    /\s+is\s+null\s+or\s+$/.test(previous.literal.text) &&
    previous.expression.getText() === column.getText()
  );
}

/** The `pgTable('name', columns, extras)` call `node` is inside, and its export. */
function enclosingTable(node: ts.Node) {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (
      ts.isCallExpression(at) &&
      ts.isIdentifier(at.expression) &&
      at.expression.text === 'pgTable' &&
      ts.isVariableDeclaration(at.parent) &&
      ts.isIdentifier(at.parent.name)
    )
      return at.parent.name;
  }
  return undefined;
}

/** The parameter `identifier` names, with its function and position. */
function parameterOf(identifier: ts.Identifier, checker: ts.TypeChecker) {
  const [declaration] =
    checker.getSymbolAtLocation(identifier)?.declarations ?? [];
  if (!declaration || !ts.isParameter(declaration)) return undefined;
  const fn = declaration.parent;
  return { fn, index: fn.parameters.indexOf(declaration) };
}

/** The symbol a function is bound to: `const name = (…) => …` or `function name`. */
function functionSymbol(fn: ts.SignatureDeclaration, checker: ts.TypeChecker) {
  const name = ts.isFunctionDeclaration(fn)
    ? fn.name
    : ts.isVariableDeclaration(fn.parent)
      ? fn.parent.name
      : undefined;
  return name && ts.isIdentifier(name)
    ? checker.getSymbolAtLocation(name)
    : undefined;
}

/** One column a CHECK reaches, and the recipe call that reached it, if any. */
type Target = {
  readonly table: ts.Identifier;
  readonly column: string;
  readonly through?: {
    readonly fn: ts.SignatureDeclaration;
    readonly call: ts.CallExpression;
  };
};

export function vocabularyColumns(
  program: ts.Program,
  isSchemaFile: (fileName: string) => boolean,
): readonly VocabularyColumn[] {
  const checker = program.getTypeChecker();
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  for (const file of program.getSourceFiles())
    if (isSchemaFile(file.fileName)) visit(file);

  const callsOf = (fn: ts.SignatureDeclaration) => {
    const symbol = functionSymbol(fn, checker);
    if (!symbol) return [];
    return calls.filter((call) => {
      const callee = checker.getSymbolAtLocation(call.expression);
      const target =
        callee && callee.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(callee)
          : callee;
      return target === symbol;
    });
  };

  /** The table columns an expression stands for: `table.col`, or a recipe's parameter. */
  function targetsOf(expression: ts.Expression): readonly Target[] {
    if (!ts.isPropertyAccessExpression(expression)) return [];
    const column = expression.name.text;
    const owner = expression.expression;
    if (!ts.isIdentifier(owner)) return [];
    const parameter = parameterOf(owner, checker);
    if (!parameter) return [];
    const table = enclosingTable(parameter.fn);
    if (table) return [{ table, column }];
    // A shared check recipe: follow every call that passes it a table.
    return callsOf(parameter.fn).flatMap((call): Target[] => {
      const argument = call.arguments[parameter.index];
      const through = { fn: parameter.fn, call };
      if (argument && ts.isIdentifier(argument)) {
        const passed = enclosingTable(call);
        return passed ? [{ table: passed, column, through }] : [];
      }
      if (argument && ts.isObjectLiteralExpression(argument)) {
        const property = argument.properties.find(
          (entry) =>
            ts.isPropertyAssignment(entry) &&
            ts.isIdentifier(entry.name) &&
            entry.name.text === column,
        );
        return property && ts.isPropertyAssignment(property)
          ? targetsOf(property.initializer).map((found) => ({
              ...found,
              through,
            }))
          : [];
      }
      return [];
    });
  }

  /** A list's vocabulary, reading a recipe's list parameter at the call that fills it. */
  function vocabularyOf(
    list: ts.Expression,
    through: Target['through'],
  ): ReadonlySet<string> | null {
    if (ts.isArrayLiteralExpression(list))
      return inlineVocabulary(list, checker);
    const parameter = ts.isIdentifier(list)
      ? parameterOf(list, checker)
      : undefined;
    if (parameter && through && parameter.fn === through.fn) {
      const argument = through.call.arguments[parameter.index];
      return argument ? vocabularyOf(argument, undefined) : null;
    }
    return listMembers(checker.getTypeAtLocation(list), checker);
  }

  const columnType = (table: ts.Identifier, column: string) => {
    const columnSymbol = checker.getTypeAtLocation(table).getProperty(column);
    if (!columnSymbol) return undefined;
    const meta = checker
      .getTypeOfSymbolAtLocation(columnSymbol, table)
      .getProperty('_');
    const data =
      meta &&
      checker.getTypeOfSymbolAtLocation(meta, table).getProperty('data');
    return data ? checker.getTypeOfSymbolAtLocation(data, table) : undefined;
  };

  return calls.flatMap((call): VocabularyColumn[] => {
    if (!ts.isIdentifier(call.expression) || call.expression.text !== 'oneOf')
      return [];
    const [columnArgument, listArgument] = call.arguments;
    if (!columnArgument || !listArgument) return [];
    const file = call.getSourceFile();
    const line =
      file.getLineAndCharacterOfPosition(call.getStart(file)).line + 1;
    const where = `${file.fileName.replace(/^.*\/packages\//, 'packages/')}:${line}`;
    const role = constrains(call, columnArgument) ? 'vocabulary' : 'predicate';
    const targets = targetsOf(columnArgument);
    if (targets.length === 0)
      return [
        {
          site: `${where} ${columnArgument.getText(file)}`,
          declared: 'unresolved',
          vocabulary: printed(vocabularyOf(listArgument, undefined)),
          role,
          exact: false,
        },
      ];
    return targets.map(({ table, column, through }) => {
      const declared = columnType(table, column);
      const values = declared ? literalsOf(declared) : null;
      const vocabulary = vocabularyOf(listArgument, through);
      return {
        site: `${where} ${table.text}.${column}`,
        declared: declared ? checker.typeToString(declared) : 'unresolved',
        vocabulary: printed(vocabulary),
        role,
        exact: Boolean(
          vocabulary &&
          (role === 'vocabulary'
            ? values && sameSet(values, vocabulary)
            : // A condition over an open column (an id) names members of
              // its own list; over a closed column, members of the column's.
              declared &&
              (declared.flags & ts.TypeFlags.String ||
                (values && isSubset(vocabulary, values)))),
        ),
      };
    });
  });
}

export function schemaProgram(
  packageRoot: string,
  overlay: ReadonlyMap<string, string> = new Map(),
) {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(packageRoot, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        );
      },
    },
  );
  if (!config) throw new Error('The db package has no tsconfig');
  const schemaDirectory = join(packageRoot, 'src', 'schema');
  const roots = [
    ...ts.sys
      .readDirectory(schemaDirectory, ['.ts'])
      .filter((file) => !/\.test(-support)?\.ts$/.test(file)),
    ...overlay.keys(),
  ];
  const host = ts.createCompilerHost(config.options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.readFile = (fileName) => overlay.get(fileName) ?? read(fileName);
  host.fileExists = (fileName) => overlay.has(fileName) || exists(fileName);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, language, ...rest) => {
    const text = overlay.get(fileName);
    return text === undefined
      ? getSourceFile(fileName, language, ...rest)
      : ts.createSourceFile(fileName, text, language, true);
  };
  return {
    program: ts.createProgram(roots, config.options, host),
    isSchemaFile: (fileName: string) =>
      dirname(fileName) === schemaDirectory && !fileName.endsWith('.d.ts'),
  };
}
