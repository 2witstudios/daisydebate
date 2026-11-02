import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

test('the actual root notes client imports under a strict code-generation boundary', async () => {
  const clientPath = import.meta
    .resolve('../src/ui/debate-room/round-notes-privacy.tsx');
  const probe = `
    globalThis.window = {};
    let attempts = 0;
    const refuse = () => { attempts += 1; throw new EvalError('CSP'); };
    globalThis.Function = new Proxy(Function, { construct: refuse, apply: refuse });
    let loaded = true;
    try { await import(${JSON.stringify(clientPath)}); } catch { loaded = false; }
    process.stdout.write(JSON.stringify({ attempts, loaded }));
  `;
  const child = Bun.spawn([process.execPath, '--eval', probe], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [output, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  assert({
    given:
      'a fresh process importing the complete root notes client dependency graph with Function refused',
    should: 'load without attempting eval or schema compilation',
    actual: { code, ...JSON.parse(output) },
    expected: { code: 0, attempts: 0, loaded: true },
  });
});
