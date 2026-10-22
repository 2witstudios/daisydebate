import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLaunchProcess } from '../e2e/support/launch-process';
setupRitewayBun();

test('owned process supervisor serializes real restart and awaits graceful child exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daisy-process-proof-'));
  const entry = join(directory, 'child.ts');
  const status = join(directory, 'status.json');
  const drained = join(directory, 'drained');
  await Bun.write(
    entry,
    `
    const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('ready')});
    await Bun.write(${JSON.stringify(status)}, JSON.stringify({pid:process.pid,url:server.url.href}));
    process.once('SIGTERM',async()=>{await Bun.write(${JSON.stringify(drained)},'drained');server.stop(true);});
  `,
  );
  const read = () =>
    Bun.file(status).json() as Promise<{ pid: number; url: string }>;
  const owned = createLaunchProcess({
    command: [process.execPath, entry],
    cwd: directory,
    env: {},
    ready: async () => {
      try {
        return (await fetch((await read()).url)).ok;
      } catch {
        return false;
      }
    },
  });
  try {
    await Promise.all([owned.start(), owned.start()]);
    const first = await read();
    await owned.restart();
    const second = await read();
    assert({
      given: 'concurrent starts followed by an actual process restart',
      should: 'serve from a fresh child after the old child drained',
      actual: [
        first.pid !== second.pid,
        await Bun.file(drained).text(),
        (await fetch(second.url)).ok,
      ],
      expected: [true, 'drained', true],
    });
    await Promise.all([owned.stop(), owned.stop()]);
    const reachable = await fetch(second.url).then(
      () => true,
      () => false,
    );
    assert({
      given: 'repeated stop of the exact owned process',
      should: 'close its actual listener',
      actual: reachable,
      expected: false,
    });
  } finally {
    await owned.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
