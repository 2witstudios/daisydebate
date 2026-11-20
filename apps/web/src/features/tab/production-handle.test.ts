import { resolve } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

test('sample handles dispatch to the same stored host page as every other handle', async () => {
  const source = resolve(import.meta.dir, '../..');
  const page = resolve(source, 'app/(host)/host/tournaments/[slug]/page.tsx');
  const release = resolve(source, 'features/tab/release.ts');
  // Keep request-store mocks inside their own process; the stored child is
  // returned by the actual page and retains its real authorization reader.
  const code = `
    import { mock } from 'bun:test';
    mock.module(${JSON.stringify(release)}, () => ({ requireTabRelease: async () => {}, hostTiersReleased: async () => false }));
    const { default: Page } = await import(${JSON.stringify(page)});
    const answers = [];
    for (const slug of ['autumn-open', 'winter-classic', 'actual-tournament']) {
      try {
        const answer = await Page({ params: Promise.resolve({ slug }) });
        answers.push([slug, answer.type.name, answer.props.handle]);
      } catch { answers.push([slug, 'refused']); }
    }
    console.log(JSON.stringify(answers));
  `;
  const child = Bun.spawn(['bun', '-e', code], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert({
    given:
      'the real host page with both formerly reserved sample handles and an ordinary handle',
    should:
      'delegate all three to StoredDrawOverview with the unchanged handle',
    actual: exit === 0 ? JSON.parse(stdout) : { exit, stderr },
    expected: ['autumn-open', 'winter-classic', 'actual-tournament'].map(
      (slug) => [slug, 'StoredDrawOverview', slug],
    ),
  });
}, 20_000);
