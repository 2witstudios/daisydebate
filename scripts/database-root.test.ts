import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  databaseRootExportIssue,
  databaseRootReferences,
} from './database-root';

setupRitewayBun();

test('detects database root imports across module syntaxes', () => {
  const source = [
    "import { createDatabase } from '@daisy/db';",
    "export type { Database } from '@daisy/db';",
    "type Database = import('@daisy/db').Database;",
    "import db = require('@daisy/db');",
    "const root = require('@daisy/db');",
    'await import(`@daisy/db`);',
    "await import('@daisy/\\u0064b');",
    "import { createDatabase } from '../src';",
    "import { createDatabase } from '../src/index.ts';",
    "import { createRoundStore } from '@daisy/db/stores/rounds';",
    "import { openDatabaseResources } from '../src/resources';",
    "const packages = ['@daisy/db'];",
  ].join('\n');
  assert({
    given: 'root references, valid subpaths and the package name used as data',
    should: 'report each root reference',
    actual: databaseRootReferences(
      'packages/db/integration/example.integration.ts',
      source,
    ).map(({ specifier }) => specifier.text),
    expected: [...Array(7).fill('@daisy/db'), '../src', '../src/index.ts'],
  });
});

test('allows area subpaths and rejects every form of a root export', () => {
  const issue = '@daisy/db: package exports must contain only area subpaths';
  assert({
    given: 'a subpath export map and the supported forms of a root export',
    should: 'reject the root forms',
    actual: [
      databaseRootExportIssue({ './resources': './src/resources.ts' }),
      databaseRootExportIssue({ '.': './src/index.ts' }),
      databaseRootExportIssue('./src/index.ts'),
      databaseRootExportIssue({ import: './src/index.ts' }),
      databaseRootExportIssue(['./src/index.ts']),
    ],
    expected: [null, issue, issue, issue, issue],
  });
});
