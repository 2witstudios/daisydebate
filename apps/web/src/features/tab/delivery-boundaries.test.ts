import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

test('Tab reads and forms use their shared delivery boundaries', async () => {
  const src = join(import.meta.dir, '../..');
  const files = [
    ...new Bun.Glob('features/tab/*-route.ts').scanSync({ cwd: src }),
    ...new Bun.Glob('features/tab/*.ts').scanSync({ cwd: src }),
    ...new Bun.Glob('app/**/*actions.ts').scanSync({ cwd: src }),
    'features/hosting-purchases/create-tournament-form.ts',
  ];
  const violations = await Promise.all(
    [...new Set(files)].sort().map(async (file) => {
      const code = await Bun.file(join(src, file)).text();
      if (
        file.endsWith('-route.ts') &&
        file.startsWith('features/tab/') &&
        file !== 'features/tab/read-route.ts' &&
        /readOnly:\s*true|\brequireSameOriginRead\b/.test(code)
      )
        return file;
      if (
        file.startsWith('app/') &&
        /from ['"][^'"]*api\/tab\/[^'"]+-command\/route['"]/.test(code) &&
        /\binProcessFetch\b/.test(code)
      )
        return file;
      if (
        !file.startsWith('app/') &&
        !file.endsWith('.test.ts') &&
        file !== 'features/tab/command-form-answer.ts' &&
        /\breceipt:\s*lobbyCommandReceiptSchema\b/.test(code)
      )
        return file;
      return null;
    }),
  );
  assert({
    given: 'Tab read routes and forms calling Tab command handlers',
    should:
      'keep release binding and command response handling in their shared modules',
    actual: violations.filter((file) => file !== null),
    expected: [],
  });
});
