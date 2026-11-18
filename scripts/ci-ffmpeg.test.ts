import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquisitionCommands,
  dropStageCommand,
  refreshStageCommand,
  verifyArchivesCommand,
  listsReusable,
  offlineCheckCommand,
  preparationDeadline,
  prefillCommand,
  regionalMirrorRewrite,
  runnerImage,
} from './ci-ffmpeg';

setupRitewayBun();

describe('ffmpeg preparation budget', () => {
  test('counts launcher and runtime startup against the budget', () => {
    assert({
      given: 'a command started at uptime 100 seconds',
      should: 'reserve termination and reporting inside 240 seconds',
      actual: preparationDeadline(100),
      expected: 330_000,
    });
  });
  test('keeps installation out of repeated acquisitions', () => {
    assert({
      given: 'an acquisition attempt',
      should: 'only refresh and authenticate downloads without running dpkg',
      actual: acquisitionCommands().map((command) =>
        command.includes('update') ? command.slice(-3) : command.slice(-5),
      ),
      expected: [
        ['-o', 'Dpkg::Use-Pty=0', 'update'],
        [
          'install',
          '-y',
          '--no-install-recommends',
          '--download-only',
          'ffmpeg',
        ],
      ],
    });
  });
});

describe('ffmpeg package cache', () => {
  const image = runnerImage({
    ImageOS: 'ubuntu24',
    ImageVersion: '20261111.127.1',
  });

  test('names the runner image', () => {
    assert({
      given: 'the runner image variables',
      should: 'identify the image the lists came from',
      actual: image,
      expected: 'ubuntu24/20261111.127.1',
    });
  });
  test('reuses lists only on the image that wrote them', () => {
    assert({
      given:
        'a staged image file from the same, another, an unknown or no image',
      should: 'reuse lists only for the same known image',
      actual: [
        listsReusable('ubuntu24/20261111.127.1\n', image),
        listsReusable('ubuntu24/20261103.120.1\n', image),
        listsReusable('unknown/unknown\n', runnerImage({})),
        listsReusable(undefined, image),
      ],
      expected: [true, false, false, false],
    });
  });
  test('prefills lists only when they are reusable', () => {
    assert({
      given: 'a stage from another image',
      should: 'copy its .debs but not its lists',
      actual: prefillCommand('/stage', false)
        .join(' ')
        .includes('/var/lib/apt/lists'),
      expected: false,
    });
  });
  test('restores lists beside the .debs on the image that wrote them', () => {
    const script = prefillCommand('/stage', true).at(-1)!;
    assert({
      given: 'a stage from this image',
      should: 'copy its .debs and its lists into apt',
      actual: [
        script.includes("'/stage/archives'"),
        script.includes("cp -R '/stage/lists'/. /var/lib/apt/lists/"),
      ],
      expected: [true, true],
    });
  });
  test('drops a restored stage the run will not reuse', () => {
    assert({
      given: 'a stage this run did not install from',
      should: 'remove exactly that directory',
      actual: dropStageCommand("/home/runner/.cache/daisy ffmpeg's"),
      expected: ['rm', '-rf', '--', "/home/runner/.cache/daisy ffmpeg's"],
    });
  });
  test('checks offline readiness without dpkg or downloads', () => {
    const script = offlineCheckCommand().at(-1)!;
    assert({
      given: 'the offline readiness check',
      should: 'only print the URIs apt would still fetch',
      actual: [script.includes('--print-uris'), script.includes('-y')],
      expected: [true, false],
    });
  });
});

describe('primary Ubuntu mirror recovery', () => {
  test('moves any regional archive host to the primary archive', () => {
    const list = [
      'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1',
      'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1',
      'https://archive.ubuntu.com/ubuntu/\tpriority:2',
      'https://security.ubuntu.com/ubuntu/\tpriority:3',
    ].join('\n');
    const rewritten = Bun.spawnSync(['sed', '-E', regionalMirrorRewrite], {
      stdin: new TextEncoder().encode(list),
    });
    assert({
      given: 'the runner mirror list with an EC2 or an Azure regional mirror',
      should: 'point both at archive.ubuntu.com and leave the others alone',
      actual: rewritten.stdout.toString().split('\n'),
      expected: [
        'http://archive.ubuntu.com/ubuntu/\tpriority:1',
        'http://archive.ubuntu.com/ubuntu/\tpriority:1',
        'https://archive.ubuntu.com/ubuntu/\tpriority:2',
        'https://security.ubuntu.com/ubuntu/\tpriority:3',
      ],
    });
  });
});

describe('archive verification', () => {
  test('an unreadable archive is deleted, and the archives after it are still checked', () => {
    const script = verifyArchivesCommand().at(-1)!;
    assert({
      given: 'the verification loop under sh -e',
      should: 'turn a failed dpkg-deb read into an empty field, never an exit',
      actual: [
        script.includes(
          'package=$(dpkg-deb -f "$deb" Package 2>/dev/null) || package=""',
        ),
        script.includes(
          'version=$(dpkg-deb -f "$deb" Version 2>/dev/null) || version=""',
        ),
      ],
      expected: [true, true],
    });
  });
});

describe('stage refresh', () => {
  test('keeps only readable archives of installed versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'daisy-ffmpeg-stage-'));
    try {
      const bin = join(root, 'bin');
      const stage = join(root, 'stage');
      Bun.spawnSync(['mkdir', '-p', bin, `${stage}.next/archives`]);
      for (const name of ['good', 'old', 'absent', 'bad'])
        writeFileSync(`${stage}.next/archives/${name}.deb`, name);
      const stub = (name: string, body: string) => {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
      };
      // bad.deb cannot be read; old.deb is not the installed version; absent.deb
      // is not installed at all.
      stub(
        'dpkg-deb',
        'case "$2" in *bad.deb) exit 2;; esac\nif [ "$3" = Package ]; then basename "$2" .deb; else echo 1; fi',
      );
      stub(
        'dpkg-query',
        'case "$3" in good) echo 1;; old) echo 0;; *) exit 1;; esac',
      );
      // The apt lists and ownership steps are outside this check.
      stub('find', 'exit 0');
      stub('chown', 'exit 0');
      const run = Bun.spawnSync(
        refreshStageCommand(stage, 'ubuntu24/test', '0:0'),
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
      );
      assert({
        given:
          'a held set with a readable installed, an older, an uninstalled and an unreadable archive',
        should: 'complete and stage only the installed version',
        actual: {
          exit: run.exitCode,
          archives: readdirSync(join(stage, 'archives')),
        },
        expected: { exit: 0, archives: ['good.deb'] },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
