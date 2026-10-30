import { readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import ts from 'typescript';
import {
  architectureExceptionRegistry,
  checkArchitectureExceptions,
  findArchitectureExceptionMarkers,
} from './architecture-exceptions';
import {
  adminSurfaceIssue,
  adobeIsolationIssue,
  allowedWorkspaceDependencies as allowed,
  conceptCouplingIssue,
  reservedWordIssue,
  deepImportIssue,
  operatorApiIssue,
  runnerOnlyIssue,
  testSupportIssue,
  forbiddenDependencyIssue,
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
    const dependencyIssue = adobeIsolationIssue(
      workspace.manifest.name,
      dependency,
      'dependency',
    );
    if (dependencyIssue) issues.push(dependencyIssue);
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
      const runnerOnly = runnerOnlyIssue(specifier, relative(root, file));
      if (runnerOnly) issues.push(`${relative(root, file)}: ${runnerOnly}`);
      const operatorApi = operatorApiIssue(specifier, relative(root, file));
      if (operatorApi) issues.push(`${relative(root, file)}: ${operatorApi}`);
      const testSupport = testSupportIssue(specifier, relative(root, file));
      if (testSupport) issues.push(`${relative(root, file)}: ${testSupport}`);
      const coupling = conceptCouplingIssue(specifier, relative(root, file));
      if (coupling) issues.push(`${relative(root, file)}: ${coupling}`);
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(`${resolve(root, workspace.path)}/`))
          issues.push(
            `${relative(root, file)}: cross-package relative import ${specifier}`,
          );
      } else if (
        !specifier.startsWith('node:') &&
        specifier !== 'bun' &&
        specifier !== 'bun:test'
      ) {
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
        const importIssue = adobeIsolationIssue(
          workspace.manifest.name,
          specifier,
          'import',
        );
        if (importIssue) issues.push(importIssue);
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
