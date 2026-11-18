import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  acquisitionCommands,
  listsReusable,
  offlineCheckCommand,
  preparationDeadline,
  prefillCommand,
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
