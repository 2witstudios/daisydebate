import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();
const hook = resolve(import.meta.dir, '../.githooks/pre-push');

describe('branch push versus main acceptance', () => {
  test('allows provisional branch pushes and verifies the exact clean main candidate', () => {
    const cases = [
      {
        destination: 'refs/heads/pu/experiment',
        dirty: false,
        old: false,
        expected: 0,
      },
      {
        destination: 'refs/heads/pu/experiment',
        dirty: true,
        old: true,
        expected: 0,
      },
      { destination: 'refs/heads/main', dirty: false, old: false, expected: 7 },
      { destination: 'refs/heads/main', dirty: true, old: false, expected: 1 },
      { destination: 'refs/heads/main', dirty: false, old: true, expected: 1 },
    ];
    const results = cases.map((candidate) => {
      const cwd = mkdtempSync(join(tmpdir(), 'daisy-push-'));
      const run = (args: string[]) =>
        Bun.spawnSync(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
      try {
        run(['git', 'init', '-q']);
        const commit = () =>
          run([
            'git',
            '-c',
            'user.name=Push test',
            '-c',
            'user.email=push@example.test',
            'commit',
            '-q',
            '--allow-empty',
            '-m',
            'candidate',
          ]);
        commit();
        const old = run(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
        commit();
        const head = run(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
        const bin = join(cwd, 'bin');
        mkdirSync(bin);
        writeFileSync(
          join(bin, 'bun'),
          '#!/bin/sh\n[ "$1" = check ] || exit 9\nexit 7\n',
          { mode: 0o755 },
        );
        run(['git', 'add', 'bin/bun']);
        commit();
        const current = run(['git', 'rev-parse', 'HEAD'])
          .stdout.toString()
          .trim();
        if (candidate.dirty)
          writeFileSync(join(cwd, 'unfinished'), 'branch work');
        return Bun.spawnSync(['sh', hook], {
          cwd,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          stdin: new Blob([
            `refs/heads/work ${candidate.old ? old : current || head} ${candidate.destination} ${'0'.repeat(40)}\n`,
          ]),
          stdout: 'pipe',
          stderr: 'pipe',
        }).exitCode;
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
    assert({
      given:
        'branch snapshots and clean, dirty or different main commits with a failing full gate',
      should: 'allow branch progress while enforcing main verification',
      actual: results,
      expected: cases.map(({ expected }) => expected),
    });
  });
});
