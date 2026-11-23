import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import ts from 'typescript';
import {
  protocolBarrel,
  protocolPackage,
  protocolRootExportIssue,
  protocolRootReferences,
  repositorySources,
} from './protocol-root';
import { moduleLoads } from './module-loads';
import { pureDatabaseModuleIssue } from './database-decisions';
import {
  databaseBarrel,
  databasePackage,
  databaseRootExportIssue,
  databaseRootReferences,
} from './database-root';
import { trackedFiles } from './tracked-files';
import { flagBoundaryProblems } from './flag-boundaries';
import { flagCatalogue } from '../apps/web/src/features/flags/catalogue';
import {
  architectureExceptionRegistry,
  checkArchitectureExceptions,
  findArchitectureExceptionMarkers,
} from './architecture-exceptions';
import {
  adminSurfaceIssue,
  adobeBanIssue,
  isAdobePackage,
  manifestDependencyFields,
  allowedWorkspaceDependencies as allowed,
  conceptCouplingIssue,
  featureUiIssue,
  reservedWordIssue,
  deepImportIssue,
  documentManagerIssue,
  stageSurfaceIssue,
  operatorApiIssue,
  runnerOnlyIssue,
  testSupportIssue,
  forbiddenDependencyIssue,
  isRuntimeImport,
} from './boundaries-rules';

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: unknown;
};
const root = resolve(import.meta.dir, '..');
const directories = (
  await Promise.all(
    ['apps', 'packages'].map(async (group) =>
      (await readdir(resolve(root, group))).map((name) => `${group}/${name}`),
    ),
  )
).flat();
const workspaces = await Promise.all(
  directories.map(async (path) => ({
    path,
    manifest: (await Bun.file(
      resolve(root, path, 'package.json'),
    ).json()) as Manifest,
  })),
);
const byName = new Map(
  workspaces.map((workspace) => [workspace.manifest.name, workspace]),
);
const issues: string[] = [];
const rootExport = protocolRootExportIssue(
  byName.get(protocolPackage)?.manifest.exports,
);
if (rootExport) issues.push(rootExport);
if (existsSync(resolve(root, protocolBarrel)))
  issues.push(`${protocolBarrel}: protocol has no root barrel`);
const databaseRootExport = databaseRootExportIssue(
  byName.get(databasePackage)?.manifest.exports,
);
if (databaseRootExport) issues.push(databaseRootExport);
if (existsSync(resolve(root, databaseBarrel)))
  issues.push(`${databaseBarrel}: the database package has no root barrel`);
for (const path of trackedFiles(root).filter(
  (file) => file === 'package.json' || file.endsWith('/package.json'),
)) {
  if (!existsSync(resolve(root, path))) continue;
  const manifest = (await Bun.file(resolve(root, path)).json()) as Record<
    string,
    unknown
  >;
  for (const field of manifestDependencyFields) {
    const declared = manifest[field];
    if (declared === null || typeof declared !== 'object') continue;
    for (const name of Object.keys(declared)) {
      const issue = adobeBanIssue(path, name, 'dependency');
      if (issue) issues.push(issue);
    }
  }
}
for (const { path, source } of repositorySources(root)) {
  // Only a source naming the scope, or holding an escape that could spell it, can load it.
  const mayLoadAdobe = /adobe|\\[ux]/i.test(source);
  for (const { specifier } of mayLoadAdobe
    ? moduleLoads(path, source, isAdobePackage)
    : []) {
    const { line } = specifier
      .getSourceFile()
      .getLineAndCharacterOfPosition(specifier.getStart());
    const issue = adobeBanIssue(
      `${path}:${line + 1}`,
      specifier.text,
      'import',
    );
    if (issue) issues.push(issue);
  }
  for (const { specifier } of protocolRootReferences(path, source)) {
    const { line } = specifier
      .getSourceFile()
      .getLineAndCharacterOfPosition(specifier.getStart());
    issues.push(
      `${path}:${line + 1}: import a protocol owner subpath instead of ${specifier.text}`,
    );
  }
  for (const { specifier } of databaseRootReferences(path, source)) {
    const { line } = specifier
      .getSourceFile()
      .getLineAndCharacterOfPosition(specifier.getStart());
    issues.push(
      `${path}:${line + 1}: open @daisy/db/resources and compose @daisy/db/stores/* instead of ${specifier.text} (R4.5)`,
    );
  }
  const pureDatabaseModule = pureDatabaseModuleIssue(path, source);
  if (pureDatabaseModule) issues.push(pureDatabaseModule);
}
const flagSources = new Map<string, string>();
/** The text of an identifier, string or JSX text node: what the reserved-word check reads. */
const wordOf = (node: ts.Node) =>
  ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isJsxText(node)
    ? node.text
    : null;
const architectureExceptionMarkers: string[] = [];
const visit = (name: string, trail: string[]) => {
  if (trail.includes(name)) {
    issues.push(`Dependency cycle: ${[...trail, name].join(' -> ')}`);
    return;
  }
  const entry = byName.get(name);
  for (const dependency of Object.keys(entry?.manifest.dependencies ?? {}))
    if (byName.has(dependency)) visit(dependency, [...trail, name]);
};
for (const workspace of workspaces) {
  visit(workspace.manifest.name, []);
  const dependencies = {
    ...workspace.manifest.dependencies,
    ...workspace.manifest.devDependencies,
  };
  if (workspace.path.startsWith('packages/') && !workspace.manifest.exports)
    issues.push(`${workspace.path}: missing explicit exports`);
  for (const dependency of Object.keys(workspace.manifest.dependencies ?? {})) {
    const forbiddenIssue = forbiddenDependencyIssue(
      workspace.path,
      workspace.manifest.name,
      dependency,
      allowed,
    );
    if (forbiddenIssue) issues.push(forbiddenIssue);
  }
  for await (const file of new Bun.Glob('**/*.{ts,tsx}').scan({
    cwd: resolve(root, workspace.path),
    absolute: true,
  })) {
    if (file.includes('/node_modules/') || file.includes('/.next/')) continue;
    const adminIssue = adminSurfaceIssue(relative(root, file));
    if (adminIssue) issues.push(adminIssue);
    architectureExceptionMarkers.push(
      ...findArchitectureExceptionMarkers(await Bun.file(file).text()),
    );
    const source = ts.createSourceFile(
      file,
      await Bun.file(file).text(),
      ts.ScriptTarget.Latest,
      true,
    );
    flagSources.set(relative(root, file), source.text);
    const check = (specifier: string) => {
      if (
        /^posthog-(js|node)(\/|$)/.test(specifier) &&
        !/^apps\/web\/src\/features\/analytics\/(client|server)-adapter\.ts$/.test(
          relative(root, file),
        )
      )
        issues.push(
          `${relative(root, file)}: PostHog SDK imports belong to analytics adapters (ADR 0037)`,
        );
      // ADR 0037's other vendor seam: @sentry/* belongs to the two runtime
      // adapters and the build wrapper, exactly as the ESLint ban says, so
      // both gates carry the same rule.
      if (
        /^@sentry\//.test(specifier) &&
        !/^(apps\/web\/src\/features\/telemetry\/|apps\/realtime\/src\/telemetry\/)/.test(
          relative(root, file),
        ) &&
        relative(root, file) !== 'apps/web/next.config.ts'
      )
        issues.push(
          `${relative(root, file)}: Sentry SDK imports belong to the telemetry adapters (ADR 0037)`,
        );
      const runnerOnly = runnerOnlyIssue(specifier, relative(root, file));
      if (runnerOnly) issues.push(`${relative(root, file)}: ${runnerOnly}`);
      const operatorApi = operatorApiIssue(specifier, relative(root, file));
      if (operatorApi) issues.push(`${relative(root, file)}: ${operatorApi}`);
      const testSupport = testSupportIssue(specifier, relative(root, file));
      if (testSupport) issues.push(`${relative(root, file)}: ${testSupport}`);
      const featureUi = featureUiIssue(specifier, relative(root, file));
      if (featureUi) issues.push(`${relative(root, file)}: ${featureUi}`);
      const coupling = conceptCouplingIssue(specifier, relative(root, file));
      if (coupling) issues.push(`${relative(root, file)}: ${coupling}`);
      const manager = documentManagerIssue(specifier, relative(root, file));
      if (manager) issues.push(manager);
      const stage = stageSurfaceIssue(specifier, relative(root, file));
      if (stage) issues.push(stage);
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(`${resolve(root, workspace.path)}/`))
          issues.push(
            `${relative(root, file)}: cross-package relative import ${specifier}`,
          );
      } else if (!isRuntimeImport(specifier)) {
        const packageName = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0]!;
        if (
          !dependencies[packageName] &&
          packageName !== workspace.manifest.name
        )
          issues.push(
            `${relative(root, file)}: undeclared dependency ${packageName}`,
          );
        const deepImport = deepImportIssue(
          specifier,
          (name) => byName.get(name)?.manifest.exports,
        );
        if (deepImport) issues.push(`${relative(root, file)}: ${deepImport}`);
      }
    };
    const walk = (node: ts.Node) => {
      const word = wordOf(node);
      const reserved = word && reservedWordIssue(relative(root, file), word);
      if (reserved) issues.push(reserved);
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        check(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))
      ) {
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) check(first.text);
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
}
issues.push(
  ...flagBoundaryProblems(
    flagSources,
    flagCatalogue.map((entry) => entry.key),
  ),
  ...checkArchitectureExceptions(
    architectureExceptionRegistry,
    architectureExceptionMarkers,
    new Date().toISOString().slice(0, 10),
  ),
);
if (issues.length) {
  console.error([...new Set(issues)].join('\n'));
  process.exit(1);
}
console.log(
  `Architecture verified: ${workspaces.length} workspaces, declared imports, acyclic dependencies, public APIs.`,
);
