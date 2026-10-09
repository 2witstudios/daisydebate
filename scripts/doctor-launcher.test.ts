import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPuLauncher } from './doctor-launcher';
setupRitewayBun();
describe('active launcher executable access', () => {
  test('checks current-process executable access and preserves candidate byte matching', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'launcher-access-'));
    try {
      mkdirSync(join(directory, '.pu'));
      mkdirSync(join(directory, 'scripts'));
      writeFileSync(
        join(directory, '.pu/config.yaml'),
        'agents:\n  codex:\n    command: scripts/agent-launch.sh codex\n',
      );
      const launcher = join(directory, 'scripts/agent-launch.sh');
      writeFileSync(launcher, '#!/bin/sh\nexit 0\n');
      chmodSync(launcher, 0o755);
      const executable = (await readPuLauncher(directory, directory)).usable;
      chmodSync(launcher, 0o641);
      const ownerCannotExecute = (await readPuLauncher(directory, directory))
        .usable;
      chmodSync(launcher, 0o755);
      const candidate = join(directory, 'candidate');
      mkdirSync(join(candidate, 'scripts'), { recursive: true });
      writeFileSync(
        join(candidate, 'scripts/agent-launch.sh'),
        '#!/bin/sh\nexit 1\n',
      );
      assert({
        given:
          'a valid launcher, an owner-readable file with only another-user execute, and mismatched bytes',
        should: 'require actual executable access and exact candidate bytes',
        actual: [
          executable,
          ownerCannotExecute,
          (await readPuLauncher(candidate, directory)).usable,
        ],
        expected: [true, process.getuid?.() === 0, false],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
