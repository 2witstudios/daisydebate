import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  drawCapableBounds,
  oneOnOneFormatFixture,
  plainRoomConfig,
} from './format-fixtures.test-support';
import { formatDefinitionSchema } from './format';
import { roomResolutionDrawSchema } from './resolution-draw';
import { freezeRoomConfig, freezeRoomExecutionPlan } from './room';

setupRitewayBun();

const hostDraw = (resolutions: string[]) => ({
  enabled: true as const,
  drawSize: 3,
  strikeWindowMs: 60_000,
  firstStriker: 'negative' as const,
  source: { kind: 'host' as const, resolutions },
});

test('a host list must be unique ignoring case', () => {
  assert({
    given: 'three distinct lines, then two that differ only in case',
    should: 'accept the first and refuse the second',
    actual: [
      roomResolutionDrawSchema.safeParse(hostDraw(['One', 'Two', 'Three']))
        .success,
      roomResolutionDrawSchema.safeParse(hostDraw(['One', 'ONE', 'Three']))
        .success,
    ],
    expected: [true, false],
  });
});

test('a bank names each category once and a host list covers the draw', () => {
  const bank = (categories: ('policy' | 'value' | 'fact')[]) => ({
    ...hostDraw([]),
    source: { kind: 'bank' as const, categories },
  });
  assert({
    given:
      'distinct and repeated bank categories, then a two-line host list drawing three',
    should: 'accept only the distinct categories',
    actual: [
      roomResolutionDrawSchema.safeParse(bank(['policy', 'value'])).success,
      roomResolutionDrawSchema.safeParse(bank(['value', 'value'])).success,
      roomResolutionDrawSchema.safeParse(hostDraw(['One', 'Two'])).success,
    ],
    expected: [true, false, false],
  });
});

test('freezing keeps a host list private as its count', () => {
  const draw = hostDraw(['One', 'Two', 'Three']);
  const bank = {
    ...draw,
    source: { kind: 'bank' as const, categories: ['value' as const] },
  };
  assert({
    given: 'a host-list config and plan, a bank config and a declined draw',
    should:
      'replace the host lines with their count and leave the others unchanged',
    actual: [
      freezeRoomConfig({ ...plainRoomConfig, resolutionDraw: draw })
        .resolutionDraw,
      freezeRoomExecutionPlan({
        preRoundPrep: { enabled: false },
        resolutionDraw: draw,
      }).resolutionDraw,
      freezeRoomConfig({ ...plainRoomConfig, resolutionDraw: bank })
        .resolutionDraw,
      freezeRoomConfig(plainRoomConfig).resolutionDraw,
    ],
    expected: [
      { ...draw, source: { kind: 'host', count: 3 } },
      { ...draw, source: { kind: 'host', count: 3 } },
      bank,
      { enabled: false },
    ],
  });
});

test('a draw-capable format holds 2 to 20 resolutions', () => {
  const withSize = (min: number, max: number) =>
    formatDefinitionSchema.safeParse({
      ...oneOnOneFormatFixture,
      configurable: {
        ...oneOnOneFormatFixture.configurable,
        resolutionDraw: { ...drawCapableBounds, drawSize: { min, max } },
      },
    }).success;
  assert({
    given: 'draw-size bounds of 3–7, 1–7 and 3–21',
    should: 'accept only the bounds inside 2–20',
    actual: [withSize(3, 7), withSize(1, 7), withSize(3, 21)],
    expected: [true, false, false],
  });
});
