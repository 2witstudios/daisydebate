import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

/**
 * ISSUE-39, ISSUE-193, ISSUE-206, ISSUE-218: production start-up refuses a
 * DATABASE_URL role that can create or alter schema objects before Next
 * prepares, and no request reaches Next before both finish. That ordering
 * lives in startProductionServer (apps/web/src/server/listen-first.ts,
 * tested there). This reads start.ts as a TypeScript program, resolving
 * relative imports and every symbol through aliases and re-exports, so
 * comments and formatting never matter and no alias, shim, `.call`,
 * optional or second call slips past a text match. start.ts must:
 * - never compose, prepare, listen or import dynamically on its own;
 * - import startProductionServer, unaliased, from ./listen-first;
 * - reference it exactly once, as the direct callee of the one call;
 * - pass that call one object literal that sets refuseRole once, by a
 *   plain key, with no spread or computed key;
 * - set it to `() => refuseSchemaAlteringRole(app, 'daisy_web')`, where
 *   refuseSchemaAlteringRole is @daisy/db's import, not a local or shadow;
 * - await the `started` the call returns.
 * `files` overlays repository-relative paths (a test's shim module).
 */
export function findRuntimeRoleGateProblem(
  startTs: string,
  files: Readonly<Record<string, string>> = {},
): string | null {
  const program = startProgram(startTs, files);
  const checker = program.getTypeChecker();
  const start = program.getSourceFile(START)!;
  const nodes = descendants(start);

  const bypass = nodes.map(bypassToken).find((token) => token !== null);
  if (bypass)
    return `start.ts bypasses the start-up gate with ${bypass}; start only through startProductionServer (ISSUE-193)`;
  if (!importsStartUnaliased(start)) return IMPORT;
  const call = theStartCall(program, checker, start, nodes);
  if (typeof call === 'string') return call;
  return refusalProblem(checker, call) ?? awaitProblem(checker, start, call);
}

type StartCall = ts.CallExpression & {
  readonly parent: ts.VariableDeclaration;
};

const descendants = (root: ts.Node): ts.Node[] => {
  const nodes: ts.Node[] = [];
  const collect = (node: ts.Node) => {
    nodes.push(node);
    ts.forEachChild(node, collect);
  };
  collect(root);
  return nodes;
};

/** The one `const { ... } = startProductionServer({ ... })` statement:
 * every identifier resolving to listen-first's export, through any alias
 * or re-export, must be that call's direct callee. */
const theStartCall = (
  program: ts.Program,
  checker: ts.TypeChecker,
  start: ts.SourceFile,
  nodes: readonly ts.Node[],
): StartCall | string => {
  const target = listenFirstExport(program, checker);
  const references = nodes.filter(
    (node): node is ts.Identifier =>
      ts.isIdentifier(node) &&
      !isImportBinding(node) &&
      target !== undefined &&
      resolved(checker, checker.getSymbolAtLocation(node)) === target,
  );
  if (references.length === 0) return MISSING;
  const [callee] = references;
  const call = callee!.parent;
  return references.length === 1 &&
    ts.isCallExpression(call) &&
    call.expression === callee &&
    call.questionDotToken === undefined &&
    isTopLevelDeclaration(start, call.parent)
    ? (call as StartCall)
    : ONE_CALL;
};

const isTopLevelDeclaration = (start: ts.SourceFile, node: ts.Node) =>
  ts.isVariableDeclaration(node) &&
  ts.isVariableDeclarationList(node.parent) &&
  ts.isVariableStatement(node.parent.parent) &&
  node.parent.parent.parent === start;

/** One object literal, refuseRole set once by a plain key to @daisy/db's
 * refuseSchemaAlteringRole, and nothing that could override it. */
const refusalProblem = (
  checker: ts.TypeChecker,
  call: StartCall,
): string | null => {
  const [options] = call.arguments;
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(options!))
    return MISSING;
  const properties = options.properties;
  const overridable = properties.some(
    (property) =>
      ts.isSpreadAssignment(property) ||
      (property.name !== undefined && ts.isComputedPropertyName(property.name)),
  );
  const refusals = properties.filter(
    (property) => propertyName(property) === 'refuseRole',
  );
  if (overridable || refusals.length > 1) return OVERRIDDEN;
  const [refusal] = refusals;
  const refused = refusal && refusalCallee(refusal);
  if (!refused) return MISSING;
  return isDaisyDbRefusal(checker.getSymbolAtLocation(refused))
    ? null
    : NOT_FROM_DB;
};

/** A top-level `await started;` on the call's own `started` binding. */
const awaitProblem = (
  checker: ts.TypeChecker,
  start: ts.SourceFile,
  call: StartCall,
): string | null => {
  const started = startedBinding(checker, call.parent);
  const awaited = start.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isAwaitExpression(statement.expression) &&
      ts.isIdentifier(statement.expression.expression) &&
      started !== undefined &&
      checker.getSymbolAtLocation(statement.expression.expression) === started,
  );
  return awaited ? null : MISSING;
};

const START = resolve('apps/web/src/server/start.ts');
const LISTEN_FIRST = resolve('apps/web/src/server/listen-first.ts');

const MISSING =
  "start.ts does not start through startProductionServer with refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') and await started";
const IMPORT =
  'start.ts must import startProductionServer, unaliased, from ./listen-first and nothing else from it (ISSUE-218)';
const ONE_CALL =
  'start.ts must call startProductionServer exactly once, directly by that name; a second call, alias, .call, optional call or other reference starts a server the checked refusal does not guard (ISSUE-206, ISSUE-218)';
const OVERRIDDEN =
  "start.ts's startProductionServer call must set refuseRole once by a plain key, with no spread or computed key that could override it (ISSUE-206, ISSUE-218)";
const NOT_FROM_DB =
  'start.ts must import refuseSchemaAlteringRole from @daisy/db and use it only as the refuseRole (ISSUE-206)';

/** The call start.ts must never make itself, as the token it reports. */
const bypassToken = (node: ts.Node): string | null => {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return 'import(';
  if (ts.isIdentifier(callee) && callee.text === 'createProductionServer')
    return 'createProductionServer(';
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const name = callee.name.text;
  if (name === 'getRequestHandler') return 'getRequestHandler(';
  if (name === 'listen') return '.listen(';
  if (
    name === 'prepare' &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'nextApp'
  )
    return 'nextApp.prepare(';
  return null;
};

const moduleOf = (declaration: ts.ImportDeclaration) =>
  ts.isStringLiteral(declaration.moduleSpecifier)
    ? declaration.moduleSpecifier.text
    : '';

/** Exactly `import { startProductionServer } from './listen-first'`, and
 * no other import binds that name or reaches ./listen-first. */
const importsStartUnaliased = (start: ts.SourceFile) => {
  const imports = start.statements.filter(ts.isImportDeclaration);
  const fromListenFirst = imports.filter(
    (declaration) => moduleOf(declaration) === './listen-first',
  );
  const named = (declaration: ts.ImportDeclaration) => {
    const bindings = declaration.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings) ? bindings.elements : [];
  };
  const [only] = fromListenFirst;
  const elements = only ? named(only) : [];
  const exact =
    fromListenFirst.length === 1 &&
    only!.importClause?.name === undefined &&
    elements.length === 1 &&
    elements[0]!.propertyName === undefined &&
    elements[0]!.name.text === 'startProductionServer';
  const elsewhere = imports
    .filter((declaration) => declaration !== only)
    .some((declaration) =>
      named(declaration).some(
        (element) =>
          (element.propertyName ?? element.name).text ===
            'startProductionServer' ||
          element.name.text === 'startProductionServer',
      ),
    );
  return exact && !elsewhere;
};

const isImportBinding = (node: ts.Identifier) =>
  ts.isImportSpecifier(node.parent) ||
  ts.isImportClause(node.parent) ||
  ts.isNamespaceImport(node.parent);

const resolved = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined) =>
  symbol && symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;

/** listen-first.ts's own exported startProductionServer symbol. */
const listenFirstExport = (program: ts.Program, checker: ts.TypeChecker) => {
  const file = program.getSourceFile(LISTEN_FIRST);
  const module = file && checker.getSymbolAtLocation(file);
  const exported = module
    ? checker
        .getExportsOfModule(module)
        .find((symbol) => symbol.name === 'startProductionServer')
    : undefined;
  return resolved(checker, exported);
};

const propertyName = (property: ts.ObjectLiteralElementLike) =>
  property.name &&
  (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : undefined;

/** The refuseSchemaAlteringRole identifier of
 * `refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web')`. */
const refusalCallee = (property: ts.ObjectLiteralElementLike) => {
  if (!ts.isPropertyAssignment(property)) return undefined;
  const arrow = property.initializer;
  if (!ts.isArrowFunction(arrow) || arrow.parameters.length > 0)
    return undefined;
  const body = arrow.body;
  if (!ts.isCallExpression(body) || !ts.isIdentifier(body.expression))
    return undefined;
  const [app, role] = body.arguments;
  return body.expression.text === 'refuseSchemaAlteringRole' &&
    body.arguments.length === 2 &&
    ts.isIdentifier(app!) &&
    app.text === 'app' &&
    ts.isStringLiteral(role!) &&
    role.text === 'daisy_web'
    ? body.expression
    : undefined;
};

/** The binding is @daisy/db's own export, imported under its own name. */
const isDaisyDbRefusal = (symbol: ts.Symbol | undefined) => {
  const [declaration] = symbol?.declarations ?? [];
  if (!declaration || !ts.isImportSpecifier(declaration)) return false;
  const importDeclaration = declaration.parent.parent.parent;
  return (
    declaration.propertyName === undefined &&
    ts.isImportDeclaration(importDeclaration) &&
    moduleOf(importDeclaration) === '@daisy/db'
  );
};

/** The `started` binding in `const { server, started } = ...`. */
const startedBinding = (
  checker: ts.TypeChecker,
  declaration: ts.VariableDeclaration,
) => {
  if (!ts.isObjectBindingPattern(declaration.name)) return undefined;
  const element = declaration.name.elements.find(
    (element) =>
      element.propertyName === undefined &&
      ts.isIdentifier(element.name) &&
      element.name.text === 'started',
  );
  return element ? checker.getSymbolAtLocation(element.name) : undefined;
};

const OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  noLib: true,
  types: [],
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};
const realSources = new Map<string, ts.SourceFile>();

/**
 * start.ts (as given) and listen-first.ts, with relative imports resolved
 * against the repository or `files` and package imports left unresolved:
 * only symbols reachable through relative modules matter here.
 */
const startProgram = (
  startTs: string,
  files: Readonly<Record<string, string>>,
) => {
  const overlay = new Map<string, string>([
    ...Object.entries(files).map(
      ([path, text]) => [resolve(path), text] as const,
    ),
    [START, startTs],
  ]);
  const read = (path: string) =>
    overlay.get(path) ??
    (existsSync(path) ? readFileSync(path, 'utf8') : undefined);
  const host = ts.createCompilerHost(OPTIONS, true);
  host.fileExists = (path) => read(path) !== undefined;
  host.readFile = read;
  host.getSourceFile = (path, languageVersion) => {
    const overlaid = overlay.get(path);
    if (overlaid !== undefined)
      return ts.createSourceFile(path, overlaid, languageVersion, true);
    const cached = realSources.get(path);
    if (cached) return cached;
    const text = read(path);
    if (text === undefined) return undefined;
    const source = ts.createSourceFile(path, text, languageVersion, true);
    realSources.set(path, source);
    return source;
  };
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal) => {
      if (!literal.text.startsWith('.')) return { resolvedModule: undefined };
      const base = resolve(dirname(containingFile), literal.text);
      const found = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]
        .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))
        .find((path) => read(path) !== undefined);
      return {
        resolvedModule: found
          ? {
              resolvedFileName: found,
              extension: found.endsWith('.tsx')
                ? ts.Extension.Tsx
                : ts.Extension.Ts,
              isExternalLibraryImport: false,
            }
          : undefined,
      };
    });
  return ts.createProgram({
    rootNames: [START, LISTEN_FIRST],
    options: OPTIONS,
    host,
  });
};
