/** Move direct Drizzle advisory-lock statements to their registry entry. */
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import {
  applyEdits,
  ensureNamedImport,
  sourceFiles,
  type Edit,
} from './sweep-support';

const root = resolve(import.meta.dir, '../../src');
const named = (name: string, argument = '') =>
  `transactionLocks.${name}(${argument})`;

const hashLocks: Readonly<Record<string, string>> = {
  '59001': 'roomCommand',
  '59002': 'roundCommand',
  '59079': 'operatorCommand',
  '59080': 'betaPreapprovalEmail',
  '71043': 'publicProfile',
};
const fixedLocks: Readonly<Record<string, string>> = {
  '59003, 1': 'botAdmission',
  '59091, 1': 'seasonCreation',
  '59081': 'nonrankedCaptureCapacity',
  "hashtextextended('necessary-evidence-capacity',0)":
    'necessaryEvidenceCapacity',
  "hashtextextended('round-analysis-capacity',59004)": 'roundAnalysisCapacity',
  "hashtextextended('resolution-bank', 59002)": 'resolutionBank',
  "hashtextextended('tab-settings-chains', 0)": 'tabSettingsChains',
};

function registryCall(template: string): string | undefined {
  const key = /^sql`select pg_advisory_xact_lock\((.+)\)`$/.exec(template)?.[1];
  if (!key) return;
  const fixed = fixedLocks[key];
  if (fixed) return named(fixed);
  const match = /^hashtextextended\(\$\{(.*)\},\s*(\d+)\)$/.exec(key);
  if (match) {
    const [, argument = '', seed = ''] = match;
    const name = hashLocks[seed];
    if (name) return named(name, argument);
    const handle =
      /^`tab-(lobby|organization)-handle:\$\{(.+)\.toLowerCase\(\)\}`$/.exec(
        argument,
      );
    if (seed === '0' && handle)
      return named(
        handle[1] === 'lobby' ? 'tabLobbyHandle' : 'tabOrganizationHandle',
        handle[2],
      );
  }
  const tab = /^59002,\s*hashtext\(\$\{(.*)\}\)$/.exec(key)?.[1];
  if (tab) return named('tabCommand', tab);
  const rating = /^59090,\s*\$\{(.*)\}::integer$/.exec(key)?.[1];
  if (rating) return named('ratingSeat', `Number(${rating})`);
}

let moved = 0;
for (const file of sourceFiles(root)) {
  const text = await Bun.file(file).text();
  if (
    !text.includes('pg_advisory_xact_lock(') ||
    file === join(root, 'locks.ts')
  )
    continue;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits: Edit[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'execute' &&
      node.arguments.length === 1
    ) {
      const call = registryCall(node.arguments[0]?.getText(source) ?? '');
      if (call)
        edits.push({
          start: node.getStart(source),
          end: node.getEnd(),
          text: `takeLock(${node.expression.expression.getText(source)}, ${call})`,
        });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (edits.length === 0) continue;
  let specifier = relative(dirname(file), join(root, 'locks'));
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  const changed = ensureNamedImport(
    applyEdits(text, edits),
    specifier,
    'takeLock',
    false,
  );
  await Bun.write(
    file,
    ensureNamedImport(changed, specifier, 'transactionLocks', false),
  );
  moved += edits.length;
}
process.stdout.write(`Moved ${moved} direct transaction locks\n`);
