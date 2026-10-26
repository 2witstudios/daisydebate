import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { connect, createServer, type Socket } from 'node:net';
import { callLaunchControl } from '../e2e/support/room-launch-settled';
import { createLaunchControl } from '../e2e/support/room-launch-control';
setupRitewayBun();
const responseCode = (path: string, operation: string) =>
  new Promise<number | undefined>((accept, reject) => {
    const call = request(
      { socketPath: path, path: operation, method: 'POST' },
      (answer) => {
        answer.resume();
        answer.once('end', () => accept(answer.statusCode));
      },
    );
    call.once('error', reject);
    call.end();
  });

test('Launch control is an owned Unix capability rather than a public HTTP listener', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daisy-unix-proof-'));
  const path = join(directory, 'control.sock');
  const server = await createLaunchControl({
    path,
    settled: async () => undefined,
    pending: () => 0,
  });
  try {
    await new Promise<void>((accept) => server.once('listening', accept));
    const response = await responseCode(path, '/settled');
    assert({
      given: 'the suite-owned socket',
      should:
        'accept only local Unix requests with owner-only filesystem access',
      actual: [
        response,
        (await stat(path)).isSocket(),
        (await stat(path)).mode & 0o777,
      ],
      expected: [204, true, 0o600],
    });
    const inherited = await responseCode(path, '/constructor');
    assert({
      given:
        'an inherited object name instead of an explicit control operation',
      should: 'refuse the request',
      actual: inherited,
      expected: 404,
    });
  } finally {
    await new Promise<void>((accept) => server.close(() => accept()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('private proof control waits for actual outstanding work and refuses unknown paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'room-launch-control-'));
  let release!: () => void;
  let entered!: () => void;
  const requested = new Promise<void>((accept) => {
    entered = accept;
  });
  const outstanding = new Promise<void>((accept) => {
    release = accept;
  });
  const control = await createLaunchControl({
    path: join(directory, 'control.sock'),
    settled: () => {
      entered();
      return outstanding;
    },
    pending: () => 0,
  });
  try {
    await new Promise<void>((accept) => control.once('listening', accept));
    let answered = false;
    const called = callLaunchControl(
      join(directory, 'control.sock'),
      'settled',
    ).then(() => {
      answered = true;
      return 204;
    });
    await requested;
    assert({
      given: 'auth work still outstanding after the control request entered',
      should: 'hold the acknowledgement until that work settles',
      actual: answered,
      expected: false,
    });
    release();
    assert({
      given: 'real Unix listener and awaited work completion',
      should: 'acknowledge settlement and refuse unknown control paths',
      actual: [
        await called,
        await responseCode(join(directory, 'control.sock'), '/unknown'),
      ],
      expected: [204, 404],
    });
  } finally {
    await new Promise<void>((accept, reject) =>
      control.close((error) => (error ? reject(error) : accept())),
    );
    assert({
      given: 'the real proof control listener closed',
      should: 'remove its owned socket through the bound cleanup handler',
      actual: await Bun.file(join(directory, 'control.sock')).exists(),
      expected: false,
    });
    await rm(directory, { recursive: true, force: true });
  }
});

test('a socket left by a killed run is replaced; a live listener is never displaced', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'room-launch-stale-'));
  const stalePath = join(directory, 'stale.sock');
  const livePath = join(directory, 'live.sock');
  const killed = Bun.spawn([
    process.execPath,
    '-e',
    `require('node:net').createServer().listen(${JSON.stringify(stalePath)}); setInterval(() => {}, 1000);`,
  ]);
  const live = createServer().listen(`${livePath}`);
  try {
    if (!live.listening)
      await new Promise<void>((accept) => live.once('listening', accept));
    while (!(await stat(stalePath).catch(() => null))) await Bun.sleep(10);
    killed.kill('SIGKILL');
    await killed.exited;
    const replaced = await createLaunchControl({
      path: stalePath,
      settled: async () => undefined,
      pending: () => 0,
    });
    await new Promise<void>((accept) => replaced.once('listening', accept));
    const answered = await responseCode(stalePath, '/settled');
    await new Promise<void>((accept) => replaced.close(() => accept()));
    const refused = await createLaunchControl({
      path: livePath,
      settled: async () => undefined,
      pending: () => 0,
    }).then(
      () => 'listening',
      (error: NodeJS.ErrnoException) => error.code ?? 'unknown',
    );
    const stillServing = await new Promise<boolean>((accept) =>
      connect(livePath)
        .once('connect', function (this: Socket) {
          this.destroy();
          accept(true);
        })
        .once('error', () => accept(false)),
    );
    assert({
      given:
        'a socket file whose owner was SIGKILLed, and one a live listener still owns',
      should:
        'listen over the stale file, and refuse the live one without deleting it (ISSUE-492)',
      actual: { answered, refused, stillServing },
      expected: { answered: 204, refused: 'EADDRINUSE', stillServing: true },
    });
  } finally {
    killed.kill('SIGKILL');
    live.close();
    await rm(directory, { recursive: true, force: true });
  }
});
