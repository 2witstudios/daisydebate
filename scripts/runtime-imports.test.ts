import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isRuntimeImport } from './boundaries-rules';
setupRitewayBun();
test('the dependency boundary recognizes built-in SQLite without allowing undeclared packages', () => {
  assert({
    given: 'pinned-runtime imports and unrelated unapproved module names',
    should: 'recognize only supplied runtime modules',
    actual: [
      'node:crypto',
      'bun',
      'bun:test',
      'bun:sqlite',
      'bun:invented',
      'sqlite',
      'drizzle-orm',
    ].map(isRuntimeImport),
    expected: [true, true, true, true, false, false, false],
  });
});
