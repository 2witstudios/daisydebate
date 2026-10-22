import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
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
  const server = createLaunchControl({
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
  const control = createLaunchControl({
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
