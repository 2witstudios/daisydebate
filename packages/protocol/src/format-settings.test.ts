import { assert, setupRitewayBun, test } from 'riteway/bun';
import { plainRoomConfig } from './format-fixtures.test-support';
import { formatSettingsSchema } from './format-settings';
import { roomConfigSchema } from './room';

setupRitewayBun();

const draw = {
  enabled: true as const,
  drawSize: 3,
  strikeWindowMs: 60_000,
  firstStriker: 'negative' as const,
};
const bank = {
  ...draw,
  source: { kind: 'bank' as const, categories: ['policy' as const] },
};
const host = {
  ...draw,
  source: { kind: 'host' as const, resolutions: ['One', 'Two', 'Three'] },
};

test('a format preset holds format settings, which a Room config embeds and extends (ISSUE-775)', () => {
  assert({
    given:
      "a preset's settings drawing from Daisy's bank, then from a host list",
    should:
      'accept the bank and refuse the host list, a Room-only input no preset may carry',
    actual: [
      formatSettingsSchema.safeParse({
        ...plainRoomConfig,
        resolutionDraw: bank,
      }).success,
      formatSettingsSchema.safeParse({
        ...plainRoomConfig,
        resolutionDraw: host,
      }).success,
    ],
    expected: [true, false],
  });
  assert({
    given: 'the same values as a Room config',
    should: 'accept both: the Room extends format settings with its host list',
    actual: [
      roomConfigSchema.safeParse({ ...plainRoomConfig, resolutionDraw: bank })
        .success,
      roomConfigSchema.safeParse({ ...plainRoomConfig, resolutionDraw: host })
        .success,
    ],
    expected: [true, true],
  });
});
