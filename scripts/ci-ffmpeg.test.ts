import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { acquisitionCommands, preparationDeadline } from './ci-ffmpeg';

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
        ['-o', 'APT::Update::Error-Mode=any', 'update'],
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
